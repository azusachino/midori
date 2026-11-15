import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../../src/db/db";
import type { ErrorResponse, UploadAcceptedDTO } from "../../src/domain/api";
import { type ImportRunner, isImportLocked } from "../../src/http/import";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { general } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

/**
 * Upload/job route (T14). Every test runs against a run-unique directory tree
 * (db, archive, spool) under .tmp-upload-<runId>/, removed in afterAll. The
 * pipeline is the real runImport unless a test injects a delay or failure.
 */

const runId = randomUUID().slice(0, 8);
const root = resolve(import.meta.dir, `../../.tmp-upload-${runId}`);
let seq = 0;

function freshDbPath(): string {
  const path = `${root}/db-${seq++}.sqlite`;
  mkdirSync(root, { recursive: true });
  return path;
}

function removeDb(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${path}${suffix}`);
    } catch {
      // absent
    }
  }
}

const validZip = () =>
  buildStoredZip([{ name: "apple_health_export/export.xml", data: general.xml }]);
const corruptZip = () => Buffer.from("PK\x03\x04 this is not a zip archive at all");

interface Harness {
  db: Database;
  dbPath: string;
  archiveDir: string;
  spoolDir: string;
  app: ReturnType<typeof createApp>;
  close: () => void;
}

function harness(
  opts: { runImport?: ImportRunner; timeoutMs?: number; maxBytes?: number } = {},
): Harness {
  const dbPath = freshDbPath();
  openDb(dbPath).close();
  const db = openDb(dbPath);
  const archiveDir = `${dbPath}.archive`;
  const spoolDir = `${dbPath}.spool`;
  const app = createApp({
    db,
    upload: { dbPath, archiveDir, spoolDir, ...opts },
  });
  return {
    db,
    dbPath,
    archiveDir,
    spoolDir,
    app,
    close: () => {
      db.close();
      removeDb(dbPath);
    },
  };
}

async function upload(
  app: Harness["app"],
  body: Uint8Array | Buffer,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request("/api/imports", {
    method: "POST",
    headers: { "content-type": "application/zip", ...headers },
    body: new Uint8Array(body),
  });
}

interface ImportRow {
  id: number;
  status: string;
  error: string | null;
  zip_name: string;
  records_seen: number | null;
  records_inserted: number | null;
}

async function waitForTerminal(h: Harness, id: number, timeoutMs = 15_000): Promise<ImportRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await h.app.request("/api/imports");
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === id);
    if (row && (row.status === "done" || row.status === "failed")) {
      return {
        id,
        status: String(row.status),
        error: (row.error as string | null) ?? null,
        zip_name: String(row.zipName),
        records_seen: row.recordsSeen as number | null,
        records_inserted: row.recordsInserted as number | null,
      };
    }
    if (Date.now() > deadline) throw new Error(`import ${id} did not finish`);
    await Bun.sleep(10);
  }
}

function spoolFiles(h: Harness): string[] {
  if (!existsSync(h.spoolDir)) return [];
  return readdirSync(h.spoolDir);
}

beforeAll(() => {
  mkdirSync(root, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/imports", () => {
  test("202 with an import id; job completes through the shared pipeline", async () => {
    const h = harness();
    try {
      const res = await upload(h.app, validZip(), { "x-zip-name": "export.zip" });
      expect(res.status).toBe(202);
      const accepted = (await res.json()) as UploadAcceptedDTO;
      expect(accepted.status).toBe("queued");
      expect(accepted.importId).toBeGreaterThan(0);

      const row = await waitForTerminal(h, accepted.importId);
      expect(row.status).toBe("done");
      expect(row.error).toBeNull();
      expect(row.zip_name).toBe("export.zip");
      expect(row.records_seen).toBeGreaterThan(0);
      expect(row.records_inserted).toBeGreaterThan(0);

      const count = h.db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number };
      expect(count.n).toBe(row.records_inserted ?? -1);
    } finally {
      h.close();
    }
  });

  test("the zip is spooled then archived; the spool is empty afterwards", async () => {
    const h = harness();
    try {
      const res = await upload(h.app, validZip());
      const { importId } = (await res.json()) as UploadAcceptedDTO;
      await waitForTerminal(h, importId);
      expect(spoolFiles(h)).toEqual([]);
      expect(existsSync(h.archiveDir)).toBe(true);
      expect(readdirSync(h.archiveDir).length).toBe(1);
    } finally {
      h.close();
    }
  });

  test("corrupt zip -> failed with a persisted error, spool cleaned, lock released", async () => {
    const h = harness();
    try {
      const res = await upload(h.app, corruptZip());
      expect(res.status).toBe(202);
      const { importId } = (await res.json()) as UploadAcceptedDTO;

      const row = await waitForTerminal(h, importId);
      expect(row.status).toBe("failed");
      expect(row.error).toBeTruthy();
      expect(spoolFiles(h)).toEqual([]);
      expect(isImportLocked(h.dbPath)).toBe(false);

      // the failure is visible through the read route with the typed row shape
      const listed = (await (await h.app.request("/api/imports")).json()) as Array<{
        id: number;
        status: string;
        error: string | null;
      }>;
      const found = listed.find((r) => r.id === importId);
      expect(found?.status).toBe("failed");
      expect(found?.error).toBe(row.error);
    } finally {
      h.close();
    }
  });

  test("malformed XML mid-parse (transaction open) -> failed, status survives rollback", async () => {
    const h = harness();
    try {
      // valid zip, broken XML after one good record: the failure happens while
      // RecordWriter holds an open transaction, the case runImport must roll back.
      const brokenXml =
        `<?xml version="1.0"?><HealthData locale="en_US"><ExportDate value="2026-01-07 08:00:00 +0900"/>` +
        `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Synthetic Watch" unit="count/min" ` +
        `startDate="2026-01-06 10:00:00 +0900" endDate="2026-01-06 10:00:00 +0900" value="60"/>` +
        `</Wrong>`;
      const zip = buildStoredZip([{ name: "apple_health_export/export.xml", data: brokenXml }]);
      const { importId } = (await (await upload(h.app, zip)).json()) as UploadAcceptedDTO;
      const row = await waitForTerminal(h, importId);
      expect(row.status).toBe("failed");
      expect(row.error).toBeTruthy();
      expect(h.db.inTransaction).toBe(false);
      const left = h.db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number };
      expect(left.n).toBe(0); // the open batch was rolled back, nothing half-written
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("retry with the same zip after a failure succeeds through the same pipeline", async () => {
    const h = harness();
    try {
      const bad = await upload(h.app, corruptZip());
      const badId = ((await bad.json()) as UploadAcceptedDTO).importId;
      expect((await waitForTerminal(h, badId)).status).toBe("failed");

      const good = await upload(h.app, validZip());
      const goodId = ((await good.json()) as UploadAcceptedDTO).importId;
      const row = await waitForTerminal(h, goodId);
      expect(row.status).toBe("done");
      expect(row.records_inserted).toBeGreaterThan(0);
    } finally {
      h.close();
    }
  });

  test("re-uploading the same zip is idempotent: everything dedups", async () => {
    const h = harness();
    try {
      const first = await waitForTerminal(
        h,
        ((await (await upload(h.app, validZip())).json()) as UploadAcceptedDTO).importId,
      );
      const second = await waitForTerminal(
        h,
        ((await (await upload(h.app, validZip())).json()) as UploadAcceptedDTO).importId,
      );
      expect(first.status).toBe("done");
      expect(second.status).toBe("done");
      expect(second.records_seen).toBe(first.records_seen);
      expect(second.records_inserted).toBe(0);
    } finally {
      h.close();
    }
  });

  test("lock contention: a POST while a job is running gets a typed 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held: ImportRunner = async (dbPath, zipPath, options) => {
      await gate;
      return runImport(dbPath, zipPath, options);
    };
    const h = harness({ runImport: held });
    try {
      const first = await upload(h.app, validZip());
      expect(first.status).toBe(202);
      const { importId } = (await first.json()) as UploadAcceptedDTO;
      expect(isImportLocked(h.dbPath)).toBe(true);

      const second = await upload(h.app, validZip());
      expect(second.status).toBe(409);
      const err = (await second.json()) as ErrorResponse;
      expect(err.retryable).toBe(true);
      expect(err.error).toContain("already running");

      release();
      expect((await waitForTerminal(h, importId)).status).toBe("done");
      expect(isImportLocked(h.dbPath)).toBe(false);

      // the lock is free again once the job is terminal
      const third = await upload(h.app, validZip());
      expect(third.status).toBe(202);
      await waitForTerminal(h, ((await third.json()) as UploadAcceptedDTO).importId);
    } finally {
      release();
      h.close();
    }
  });

  test("two concurrent POSTs: exactly one is accepted, the other gets 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = harness({
      runImport: async (dbPath, zipPath, options) => {
        await gate;
        return runImport(dbPath, zipPath, options);
      },
    });
    try {
      const [a, b] = await Promise.all([upload(h.app, validZip()), upload(h.app, validZip())]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([202, 409]);
      const accepted = a.status === 202 ? a : b;
      release();
      await waitForTerminal(h, ((await accepted.json()) as UploadAcceptedDTO).importId);
    } finally {
      release();
      h.close();
    }
  });

  test("a job that throws outside the pipeline still releases the lock", async () => {
    const h = harness({
      runImport: async () => {
        throw new Error("injected crash");
      },
    });
    try {
      const res = await upload(h.app, validZip());
      const { importId } = (await res.json()) as UploadAcceptedDTO;
      const row = await waitForTerminal(h, importId);
      expect(row.status).toBe("failed");
      expect(row.error).toBe("injected crash");
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("time limit: a job past its budget is aborted, failed, and the lock is released", async () => {
    const h = harness({
      timeoutMs: 50,
      runImport: async (dbPath, zipPath, options) => {
        // simulate a slow job that honours the abort signal at its next boundary
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          options.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("import aborted: exceeded 50 ms time limit"));
          });
        });
        return runImport(dbPath, zipPath, options);
      },
    });
    try {
      const { importId } = (await (await upload(h.app, validZip())).json()) as UploadAcceptedDTO;
      const row = await waitForTerminal(h, importId);
      expect(row.status).toBe("failed");
      expect(row.error).toContain("time limit");
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("oversize Content-Length -> 413 typed error, nothing queued, nothing spooled", async () => {
    const h = harness({ maxBytes: 1024 });
    try {
      const res = await upload(h.app, validZip(), { "content-length": "999999" });
      expect(res.status).toBe(413);
      const err = (await res.json()) as ErrorResponse;
      expect(err.retryable).toBe(false);
      const rows = (await (await h.app.request("/api/imports")).json()) as unknown[];
      expect(rows.length).toBe(0);
      expect(spoolFiles(h)).toEqual([]);
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("body larger than the ceiling without a truthful Content-Length -> 413, spool removed", async () => {
    const h = harness({ maxBytes: 1024 });
    try {
      const big = new Uint8Array(4096);
      const res = await upload(h.app, big);
      expect(res.status).toBe(413);
      expect(spoolFiles(h)).toEqual([]);
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("wrong content-type -> 415 typed error", async () => {
    const h = harness();
    try {
      const res = await h.app.request("/api/imports", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      });
      expect(res.status).toBe(415);
      expect(((await res.json()) as ErrorResponse).retryable).toBe(false);
    } finally {
      h.close();
    }
  });

  test("read routes still work when upload is mounted", async () => {
    const h = harness();
    try {
      const res = await h.app.request("/api/sources");
      expect(res.status).toBe(200);
    } finally {
      h.close();
    }
  });
});
