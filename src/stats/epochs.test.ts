import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { REPLACEMENT_SOURCE, replacementWatchSpec } from "../../tests/fixtures/replacement-watch";
import { applyMigrations } from "../db/db";
import { parseHealthKitDate } from "../domain/dates";
import { devicePart } from "../ingest/parser";
import { derive } from "./derive";

let db: Database;
afterEach(() => db?.close());

function loadReplacementFixture(): void {
  const fixture = replacementWatchSpec();
  db = new Database(":memory:");
  applyMigrations(db);
  db.run(
    "INSERT INTO imports (created_at, zip_name, zip_size, status, export_date) VALUES (?, ?, ?, 'done', ?)",
    ["2026-04-06T00:00:00.000Z", "synthetic.zip", 1, fixture.exportDate],
  );
  const insert = db.prepare(
    `INSERT INTO records (type, source_name, unit, start_at, end_at, start_offset_min,
       end_offset_min, value, value_str, import_id, device_hw, device_sw, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  for (const row of fixture.records) {
    const start = parseHealthKitDate(row.startDate);
    const end = parseHealthKitDate(row.endDate);
    if (!start.ok || !end.ok) throw new Error(`invalid fixture date: ${row.startDate}`);
    insert.run(
      row.type,
      row.sourceName,
      row.unit ?? null,
      start.date.utcIso,
      end.date.utcIso,
      start.date.offsetMinutes,
      end.date.offsetMinutes,
      row.value === undefined ? null : Number(row.value),
      row.value ?? null,
      devicePart(row.device ?? null, "hardware"),
      devicePart(row.device ?? null, "software"),
      row.metadata ? JSON.stringify(row.metadata) : null,
    );
  }
}

describe("epoch derivation through derive()", () => {
  test("B-D1 same-name replacement watch yields two hardware epochs", () => {
    loadReplacementFixture();
    derive(db);
    expect(
      db
        .query("SELECT device_hw, kind FROM epochs WHERE source_name = ? ORDER BY device_hw")
        .all(REPLACEMENT_SOURCE),
    ).toEqual([
      { device_hw: "Watch5,9", kind: "watch" },
      { device_hw: "Watch7,5", kind: "watch" },
    ]);
  });

  test("B-D2 device-less sleep and resting-HR rows inherit by nearest record time", () => {
    loadReplacementFixture();
    derive(db);
    expect(
      db
        .query("SELECT device_hw AS hardware, days_present AS days FROM epochs ORDER BY device_hw")
        .all(),
    ).toEqual([
      { hardware: "Watch5,9", days: 2 },
      { hardware: "Watch7,5", days: 3 },
    ]);
  });

  test("B-D8 increasing software versions persist one OS-update event", () => {
    loadReplacementFixture();
    derive(db);
    expect(db.query("SELECT day, kind, detail FROM epoch_events").all()).toEqual([
      { day: "2026-04-05", kind: "os_update", detail: "11.0 → 11.1" },
    ]);
  });
});
