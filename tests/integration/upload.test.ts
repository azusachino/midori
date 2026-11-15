import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
const wrongExportZip = () =>
  buildStoredZip([{ name: "apple_health_export/export_cda.xml", data: "<CDA/>" }]);

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
  test("B-I7/B-I8 upload continues in background and exposes parsing progress through HTTP", async () => {
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
      const detail = await h.app.request(`/api/imports/${accepted.importId}`);
      const dto = (await detail.json()) as Record<string, unknown>;
      expect(dto.stage).toBe("done");
      expect(dto.progress).toBeGreaterThan(0);
      expect(dto.progressTotal).toBeGreaterThanOrEqual(dto.progress as number);
      expect(dto.newUsableNights).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(dto.newEpochs)).toBe(true);
      expect(dto.exportDate).toBe("2026-01-07 08:00:00 +0900");
      expect(dto.retryable).toBe(false);
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

  test("B-I8 M6 exposes uncompressed progress and per-import new usable nights and epoch labels", async () => {
    const h = harness();
    try {
      const first = await upload(h.app, validZip());
      const firstId = ((await first.json()) as UploadAcceptedDTO).importId;
      expect((await waitForTerminal(h, firstId)).status).toBe("done");
      const priorEpochs = new Set(
        (
          h.db.query("SELECT source_name, device_hw FROM epochs").all() as Array<{
            source_name: string;
            device_hw: string;
          }>
        ).map((epoch) => JSON.stringify([epoch.source_name, epoch.device_hw])),
      );
      const priorUsableNights = (
        h.db
          .query(
            "SELECT COUNT(DISTINCT unit_day) AS count FROM metric_values WHERE metric='sleep_h' AND usable=1",
          )
          .get() as { count: number }
      ).count;
      const expandedXml = general.xml.replace(
        "</HealthData>",
        '<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Synthetic New Watch" unit="count" startDate="2026-01-06 12:00:00 +0000" endDate="2026-01-06 12:00:00 +0000" value="1200" device="&lt;&lt;HKDevice: 0x3&gt;, name:Synthetic New Watch, hardware:Watch9,1, software:26.2, model:Watch&gt;"/></HealthData>',
      );
      const second = await upload(
        h.app,
        buildStoredZip([{ name: "apple_health_export/export.xml", data: expandedXml }]),
      );
      const { importId } = (await second.json()) as UploadAcceptedDTO;
      expect((await waitForTerminal(h, importId)).status).toBe("done");
      const detail = await h.app.request(`/api/imports/${importId}`);
      const dto = (await detail.json()) as Record<string, unknown>;
      expect(dto.progressTotal).toBeGreaterThan(0);
      expect(dto.progress).toBe(dto.progressTotal);
      const usableNights = (
        h.db
          .query(
            "SELECT COUNT(DISTINCT unit_day) AS count FROM metric_values WHERE metric='sleep_h' AND usable=1",
          )
          .get() as { count: number }
      ).count;
      expect(dto.newUsableNights).toBe(Math.max(0, usableNights - priorUsableNights));
      const newEpochs = dto.newEpochs as string[];
      expect(newEpochs).toEqual(["Synthetic New Watch (Watch9,1)"]);
      const persisted = h.db.query("SELECT new_epochs FROM imports WHERE id = ?").get(importId) as {
        new_epochs: string;
      };
      expect(persisted.new_epochs).toBe(JSON.stringify(newEpochs));
      const listed = (await (await h.app.request("/api/imports")).json()) as Array<
        Record<string, unknown>
      >;
      expect(listed.find((row) => row.id === importId)?.newEpochs).toEqual(newEpochs);
      expect(priorEpochs.has(JSON.stringify(["Synthetic New Watch", "Watch9,1"]))).toBe(false);
    } finally {
      h.close();
    }
  });

  test("B-I5 L5 mount removes expired spools and orphaned upload parts", () => {
    const h = harness();
    try {
      mkdirSync(h.spoolDir, { recursive: true });
      const expired = `${h.spoolDir}/expired.zip`;
      const part = `${h.spoolDir}/orphan.part`;
      writeFileSync(expired, "old spool");
      writeFileSync(part, "interrupted upload");
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      utimesSync(expired, old, old);
      createApp({
        db: h.db,
        upload: { dbPath: h.dbPath, archiveDir: h.archiveDir, spoolDir: h.spoolDir },
      });
      expect(existsSync(expired)).toBe(false);
      expect(existsSync(part)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("B-I1 non-Health and corrupt zips return 400 before a job row exists", async () => {
    const h = harness();
    try {
      for (const zip of [wrongExportZip(), corruptZip()]) {
        const res = await upload(h.app, zip);
        expect(res.status).toBe(400);
        expect(((await res.json()) as ErrorResponse).error).toContain("Health export");
      }
      const rows = (await (await h.app.request("/api/imports")).json()) as unknown[];
      expect(rows).toHaveLength(0);
      expect(spoolFiles(h)).toEqual([]);
      expect(isImportLocked(h.dbPath)).toBe(false);
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
      expect(h.db.query("SELECT stage FROM imports WHERE id = ?").get(importId)).toEqual({
        stage: "parsing",
      });
      expect(h.db.inTransaction).toBe(false);
      const left = h.db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number };
      expect(left.n).toBe(0); // the open batch was rolled back, nothing half-written
      expect(isImportLocked(h.dbPath)).toBe(false);
    } finally {
      h.close();
    }
  });

  test("B-I5 retry reuses the failed job spool and completes through HTTP", async () => {
    let shouldFail = true;
    const h = harness({
      runImport: async (dbPath, zipPath, options) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("injected first attempt failure");
        }
        return runImport(dbPath, zipPath, options);
      },
    });
    try {
      const first = await upload(h.app, validZip());
      const { importId } = (await first.json()) as UploadAcceptedDTO;
      expect((await waitForTerminal(h, importId)).status).toBe("failed");
      expect(spoolFiles(h)).toEqual([`${importId}.zip`]);
      const get = await h.app.request(`/api/imports/${importId}`);
      expect(get.status).toBe(200);
      const item = (await get.json()) as Record<string, unknown>;
      expect(item.retryable).toBe(true);
      expect(item.stage).toBe("queued");
      expect(item.error).toContain("injected first attempt failure");

      const retry = await h.app.request(`/api/imports/${importId}/retry`, { method: "POST" });
      expect(retry.status).toBe(202);
      expect(((await retry.json()) as UploadAcceptedDTO).importId).toBe(importId);
      expect((await waitForTerminal(h, importId)).status).toBe("done");
    } finally {
      h.close();
    }
  });

  test("B-I4 an older export is accepted and reports olderThanStored", async () => {
    const h = harness();
    try {
      const first = await upload(h.app, validZip());
      await waitForTerminal(h, ((await first.json()) as UploadAcceptedDTO).importId);
      const olderXml = general.xml.replace(
        "2026-01-07 08:00:00 +0900",
        "2025-12-01 08:00:00 +0900",
      );
      const olderZip = buildStoredZip([{ name: "apple_health_export/export.xml", data: olderXml }]);
      const second = await upload(h.app, olderZip);
      expect(second.status).toBe(202);
      const { importId } = (await second.json()) as UploadAcceptedDTO;
      expect((await waitForTerminal(h, importId)).status).toBe("done");
      const detail = await h.app.request(`/api/imports/${importId}`);
      expect(((await detail.json()) as Record<string, unknown>).olderThanStored).toBe(true);
    } finally {
      h.close();
    }
  });

  test("B-I3 re-uploading the same zip is idempotent: everything dedups", async () => {
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

  test("B-I5 expired retry spool returns 410 over HTTP", async () => {
    const h = harness({
      runImport: async () => {
        throw new Error("injected failure");
      },
    });
    try {
      const res = await upload(h.app, validZip());
      const { importId } = (await res.json()) as UploadAcceptedDTO;
      await waitForTerminal(h, importId);
      const path = `${h.spoolDir}/${importId}.zip`;
      const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
      utimesSync(path, expired, expired);
      const retry = await h.app.request(`/api/imports/${importId}/retry`, { method: "POST" });
      expect(retry.status).toBe(410);
      expect(((await retry.json()) as ErrorResponse).retryable).toBe(false);
    } finally {
      h.close();
    }
  });

  test("B-I2 lock contention: a POST while a job is running gets a typed 409", async () => {
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
});
