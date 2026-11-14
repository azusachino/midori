import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { applyMigrations, openDb } from "./db";
import * as schema from "./schema";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "midori-db-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("migrations", () => {
  test("applies 0001 and is idempotent on re-run", () => {
    const db = new Database(":memory:");
    const first = applyMigrations(db);
    expect(first).toEqual(["0001_init.sql"]);
    const second = applyMigrations(db);
    expect(second).toEqual([]);
    db.close();
  });

  test("file db opens in WAL mode and reopens without new migrations", () => {
    const p = join(dir, "wal.db");
    const db = openDb(p);
    const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    expect(mode).toBe("wal");
    db.close();
    const reopened = new Database(p);
    expect(applyMigrations(reopened)).toEqual([]);
    reopened.close();
  });
});

describe("records dedup unique key", () => {
  let db: Database;
  const base = {
    type: "HKQuantityTypeIdentifierHeartRate",
    source_name: "ハルのiPhone",
    start_at: "2026-11-01T02:00:00.000Z",
    end_at: "2026-11-01T02:01:00.000Z",
  };

  function insertRec(
    overrides: Partial<typeof base> & { value?: number | null; value_str?: string | null },
  ) {
    return db
      .prepare(
        `INSERT INTO records (type, source_name, unit, start_at, end_at, value, value_str, import_id)
         VALUES (?, ?, 'count/min', ?, ?, ?, ?, 1)`,
      )
      .run(
        overrides.type ?? base.type,
        overrides.source_name ?? base.source_name,
        overrides.start_at ?? base.start_at,
        overrides.end_at ?? base.end_at,
        overrides.value === undefined ? null : overrides.value,
        overrides.value_str === undefined ? null : overrides.value_str,
      );
  }

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO imports (created_at, zip_name, zip_size, status) VALUES ('2026-11-14T00:00:00Z', 'export.zip', 66, 'done')`,
    ).run();
  });

  test("byte-identical duplicate is rejected", () => {
    insertRec({ value: 72 });
    expect(() => insertRec({ value: 72 })).toThrow(/UNIQUE/);
  });

  test("numeric equivalence: 60 and 60.0 are the same record", () => {
    insertRec({ value: 60 });
    expect(() => insertRec({ value: 60.0 })).toThrow(/UNIQUE/);
  });

  test("NULL-value duplicates collapse; NULL is distinct from a value", () => {
    expect(() => insertRec({ value: null })).not.toThrow();
    expect(() => insertRec({ value: null, value_str: null })).toThrow(/UNIQUE/);
    expect(() => insertRec({ value: 61 })).not.toThrow();
  });

  test("different source or start is not a duplicate", () => {
    expect(() => insertRec({ value: 72, source_name: "別のWatch" })).not.toThrow();
    expect(() => insertRec({ value: 72, start_at: "2026-11-01T03:00:00.000Z" })).not.toThrow();
  });
});

describe("check constraints", () => {
  test("device_events.kind only allows first_seen|last_seen|switch", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO imports (created_at, zip_name, zip_size, status) VALUES ('2026-11-14T00:00:00Z', 'z', 1, 'done')`,
    ).run();
    const ins = db.prepare(
      `INSERT INTO device_events (kind, source_name, metric, occurred_on, import_id) VALUES (?, 's', NULL, '2026-11-01', 1)`,
    );
    for (const kind of ["first_seen", "last_seen", "switch"]) {
      expect(() => ins.run(kind)).not.toThrow();
    }
    expect(() => ins.run("rebooted")).toThrow(/CHECK/);
    db.close();
  });
});

describe("schema.ts mirrors the SQL migrations", () => {
  test("every drizzle table's column set matches PRAGMA table_info", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const tables: Record<string, SQLiteTable> = {
      imports: schema.imports,
      sources: schema.sources,
      records: schema.records,
      daily_metrics: schema.dailyMetrics,
      device_events: schema.deviceEvents,
      findings: schema.findings,
    };
    for (const [name, table] of Object.entries(tables)) {
      const sqlCols = (
        db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      const tsCols = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(new Set(tsCols)).toEqual(new Set(sqlCols));
    }
    db.close();
  });
});
