import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { rebuildMetricValues } from "./values";

describe("metric value usability", () => {
  test("B-N7 usable requires a complete night and the metric sample minimum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      "INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES ('watch', 'Watch1,1', 'watch', '2026-01-01', '2026-01-03', 3)",
    ).run();
    db.prepare(
      "INSERT INTO nights (date, zone, partial_reason) VALUES ('2026-01-01', 'UTC', NULL), ('2026-01-02', 'UTC', 'export_cut'), ('2026-01-03', 'UTC', NULL)",
    ).run();
    const insert = db.prepare(
      "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES (?, 1, ?, ?, 1, ?, 0)",
    );
    insert.run("hrv_sdnn", "2026-01-01", "night", 2);
    insert.run("hrv_sdnn", "2026-01-02", "night", 3);
    insert.run("hrv_sdnn", "2026-01-03", "night", 3);
    insert.run("wrist_temp", "2026-01-02", "night", 1);
    insert.run("steps", "2026-01-03", "day", 1);
    expect(rebuildMetricValues(db)).toBe(5);
    expect(
      db
        .query("SELECT metric, unit_day AS day, usable FROM metric_values ORDER BY metric, day")
        .all(),
    ).toEqual([
      { metric: "hrv_sdnn", day: "2026-01-01", usable: 0 },
      { metric: "hrv_sdnn", day: "2026-01-02", usable: 0 },
      { metric: "hrv_sdnn", day: "2026-01-03", usable: 1 },
      { metric: "steps", day: "2026-01-03", usable: 1 },
      { metric: "wrist_temp", day: "2026-01-02", usable: 0 },
    ]);
    db.close();
  });
});
