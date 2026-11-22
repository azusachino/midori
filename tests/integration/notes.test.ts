import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { type RecordSpec, renderExport, SLEEP_VALUE, TYPE } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

const dirs: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeApp(readOnly = false) {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.run(
    `INSERT INTO imports (created_at, zip_name, zip_size, status) VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  );
  databases.push(db);
  const dir = mkdtempSync(join(tmpdir(), "midori-notes-"));
  dirs.push(dir);
  return createApp({
    db,
    ...(readOnly
      ? {}
      : {
          upload: {
            dbPath: join(dir, "midori.db"),
            archiveDir: join(dir, "archive"),
            spoolDir: join(dir, "spool"),
            backupDir: join(dir, "backups"),
          },
        }),
  });
}

const body = {
  startDay: "2026-02-10",
  endDay: "2026-02-12",
  category: "travel",
  label: "  long flight ",
};

function jsonRequest(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

describe("notes REST (B-U1–B-U4)", () => {
  test("B-U1 POST validates and creates a note", async () => {
    const app = makeApp();
    const res = await app.request("/api/notes", jsonRequest("POST", body));
    expect(res.status).toBe(201);
    const note = (await res.json()) as Record<string, unknown>;
    expect(note).toMatchObject({
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel",
      label: "long flight",
    });
    expect(typeof note.createdAt).toBe("string");

    for (const invalid of [
      { ...body, startDay: "2026-02-30" },
      { ...body, endDay: "2026-02-09" },
      { ...body, category: "work" },
      { ...body, label: "   " },
    ]) {
      const bad = await app.request("/api/notes", jsonRequest("POST", invalid));
      expect(bad.status).toBe(400);
      const error = (await bad.json()) as { error: string; retryable: boolean };
      expect(typeof error.error).toBe("string");
      expect(error.retryable).toBe(false);
    }
  });

  test("B-U2 PATCH merges partial fields, validates the merged row, and DELETE reports", async () => {
    const app = makeApp();
    const created = (await (await app.request("/api/notes", jsonRequest("POST", body))).json()) as {
      id: number;
    };

    const patched = await app.request(
      `/api/notes/${created.id}`,
      jsonRequest("PATCH", { label: "flight home" }),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel",
      label: "flight home",
    });

    const inverted = await app.request(
      `/api/notes/${created.id}`,
      jsonRequest("PATCH", { endDay: "2026-02-09" }),
    );
    expect(inverted.status).toBe(400);
    expect(((await inverted.json()) as { retryable: boolean }).retryable).toBe(false);

    const missing = await app.request("/api/notes/999", jsonRequest("PATCH", { label: "nope" }));
    expect(missing.status).toBe(404);

    const deleted = await app.request(`/api/notes/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    const again = await app.request(`/api/notes/${created.id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  test("B-U2 read-only mode returns 405 for mutations and still serves reads", async () => {
    const app = makeApp(true);
    for (const [method, path] of [
      ["POST", "/api/notes"],
      ["PATCH", "/api/notes/1"],
      ["DELETE", "/api/notes/1"],
    ] as const) {
      const res = await app.request(
        path,
        method === "POST" || method === "PATCH" ? jsonRequest(method, body) : { method },
      );
      expect(res.status).toBe(405);
      expect(await res.json()).toEqual({ error: "notes are read-only", retryable: false });
    }
    expect((await app.request("/api/notes")).status).toBe(200);
  });

  test("B-U4 GET validates dates, filters overlap, and orders newest first", async () => {
    const app = makeApp();
    await app.request(
      "/api/notes",
      jsonRequest("POST", { ...body, startDay: "2026-02-01", endDay: "2026-02-10", label: "flu" }),
    );
    await app.request(
      "/api/notes",
      jsonRequest("POST", {
        ...body,
        startDay: "2026-02-05",
        endDay: "2026-02-05",
        label: "party",
      }),
    );

    const all = (await (await app.request("/api/notes")).json()) as {
      notes: Array<{ label: string }>;
    };
    expect(all.notes.map((note) => note.label)).toEqual(["party", "flu"]);

    const filtered = (await (
      await app.request("/api/notes?from=2026-02-06&to=2026-02-07")
    ).json()) as { notes: Array<{ label: string }> };
    expect(filtered.notes.map((note) => note.label)).toEqual(["flu"]);

    for (const query of ["from=2026-02-30", "to=2026-13-01"]) {
      const bad = await app.request(`/api/notes?${query}`);
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { retryable: boolean }).retryable).toBe(false);
    }
  });

  test("B-C7 an overlapping note flags user_note on computed rows over /api/changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-notes-bc7-"));
    dirs.push(dir);
    const dbPath = join(dir, "fixture.db");
    const zipPath = join(dir, "fixture.zip");
    const device =
      "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";
    const records: RecordSpec[] = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return {
        type: TYPE.sleep,
        sourceName: "Synthetic Watch",
        startDate: `2026-02-${day} 22:00:00 +0000`,
        endDate: `2026-02-${String(index + 2).padStart(2, "0")} 06:00:00 +0000`,
        value: SLEEP_VALUE.core,
        device,
      };
    });
    writeFileSync(
      zipPath,
      buildStoredZip([
        {
          name: "apple_health_export/export.xml",
          data: renderExport({
            exportDate: "2026-02-21 08:00:00 +0000",
            records,
            workouts: [],
          }),
        },
      ]),
    );
    await runImport(dbPath, zipPath);
    const db = new Database(dbPath);
    databases.push(db);
    const app = createApp({ db });

    const before = (await (await app.request("/api/changes")).json()) as {
      overnight: Array<{ metric: string; checks: Array<Record<string, unknown>> }>;
    };
    expect(
      before.overnight
        .find((row) => row.metric === "sleep_h")
        ?.checks.find((check) => check.key === "user_note"),
    ).toEqual({ key: "user_note", flagged: false });

    db.run(
      `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
       VALUES ('2026-02-05', '2026-02-05', 'illness', 'fever', '2026-02-05T00:00:00Z', '2026-02-05T00:00:00Z')`,
    );
    const after = (await (await app.request("/api/changes")).json()) as {
      overnight: Array<{ metric: string; checks: Array<Record<string, unknown>> }>;
    };
    expect(
      after.overnight
        .find((row) => row.metric === "sleep_h")
        ?.checks.find((check) => check.key === "user_note"),
    ).toEqual({ key: "user_note", flagged: true, day: "2026-02-05", count: 1 });
  });
});
