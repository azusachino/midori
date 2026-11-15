import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { derive } from "./derive";

let db: Database;
afterEach(() => db?.close());

function freshDb(exportDate: string): Database {
  db = new Database(":memory:");
  applyMigrations(db);
  db.run(
    "INSERT INTO imports (created_at, zip_name, zip_size, status, export_date) VALUES (?, ?, ?, 'done', ?)",
    ["2026-01-04T00:00:00.000Z", "synthetic.zip", 1, exportDate],
  );
  return db;
}

function sleep(day: string, zone: string): void {
  const start = `${day}T23:00:00.000Z`;
  const end = new Date(Date.parse(start) + 8 * 60 * 60_000).toISOString();
  db.run(
    `INSERT INTO records (type, source_name, start_at, end_at, start_offset_min, end_offset_min,
      value_str, import_id, device_hw, meta_json)
     VALUES ('HKCategoryTypeIdentifierSleepAnalysis', 'Synthetic Watch', ?, ?, 0, 0,
       'HKCategoryValueSleepAnalysisAsleepCore', 1, 'Watch1,1', ?)`,
    [start, end, JSON.stringify({ HKTimeZone: zone })],
  );
}

describe("night derivation through derive()", () => {
  test("B-N1 night timezone controls assignment and persisted timezone", () => {
    freshDb("2026-01-04 12:00:00 +0000");
    sleep("2026-01-01", "America/Los_Angeles");
    sleep("2026-01-02", "America/Los_Angeles");
    derive(db);
    expect(db.query("SELECT date, zone FROM nights ORDER BY date").all()).toEqual([
      { date: "2026-01-01", zone: "America/Los_Angeles" },
      { date: "2026-01-02", zone: "America/Los_Angeles" },
    ]);
  });

  test("B-N6 marks a night partial when its next-noon window exceeds ExportDate", () => {
    freshDb("2026-01-03 10:00:00 +0000");
    sleep("2026-01-01", "America/Los_Angeles");
    sleep("2026-01-02", "America/Los_Angeles");
    derive(db);
    expect(db.query("SELECT date, partial_reason FROM nights ORDER BY date").all()).toEqual([
      { date: "2026-01-01", partial_reason: null },
      { date: "2026-01-02", partial_reason: "export_cut" },
    ]);
  });
});
