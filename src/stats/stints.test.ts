import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { addDays } from "../domain/dates";
import { derive } from "./derive";

let db: Database;
afterEach(() => db?.close());

function addStep(day: string, hardware: string, value: number): void {
  const start = `${day}T12:00:00.000Z`;
  db.run(
    `INSERT INTO records (type, source_name, start_at, end_at, start_offset_min, end_offset_min,
      value, import_id, device_hw) VALUES ('HKQuantityTypeIdentifierStepCount', 'Synthetic Watch',
      ?, ?, 0, 0, ?, 1, ?)`,
    [start, new Date(Date.parse(start) + 60_000).toISOString(), value, hardware],
  );
}

describe("primary series through derive()", () => {
  test("B-D4b primary absence has no value for the current primary on that unit", () => {
    db = new Database(":memory:");
    applyMigrations(db);
    db.run(
      `INSERT INTO imports (created_at, zip_name, zip_size, status, export_date)
       VALUES ('2026-02-01T00:00:00Z', 'synthetic.zip', 1, 'done', '2026-02-01 12:00:00 +0000')`,
    );
    for (let i = 0; i < 14; i++) addStep(addDays("2026-01-01", i), "iPhone1,1", 1000);
    for (let i = 14; i < 21; i++) addStep(addDays("2026-01-01", i), "Watch1,1", 1200);
    addStep("2026-01-22", "iPhone1,1", 1000);

    derive(db);

    expect(
      db
        .query(`SELECT COUNT(*) AS count FROM metric_values mv JOIN stints s
        ON s.metric = mv.metric AND s.epoch_id = mv.epoch_id
        AND s.start_day <= mv.unit_day AND (s.end_day IS NULL OR s.end_day >= mv.unit_day)
        WHERE mv.metric = 'steps' AND mv.unit_day = '2026-01-22'`)
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM metric_values WHERE metric='steps' AND unit_day='2026-01-22'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});
