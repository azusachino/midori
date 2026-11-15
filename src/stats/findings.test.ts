import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import type { BaselineResult } from "./baselines";
import { rebuildFindings } from "./findings";

function baseline(
  metric: string,
  severity: BaselineResult["severity"],
  z: number | null,
): BaselineResult {
  return {
    metric,
    state: "computed",
    z,
    dispersion: 1,
    severity,
    confidence: "high",
    onsetDay: "2026-01-14",
    onsetOpen: false,
    recent: 12,
    baseline: 10,
    kOutside: 5,
    progress: 35,
    asOfDay: "2026-01-20",
    stintId: metric === "steps" ? 2 : 1,
  };
}

function makeDb() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES
     ('watch', 'Watch1,1', 'watch', '2025-01-01', '2026-01-20', 385),
     ('phone', 'iPhone15,2', 'phone', '2025-01-01', '2026-01-20', 385)`,
  ).run();
  db.prepare(
    `INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES
     ('sleep_h', 1, '2025-01-01', NULL), ('steps', 2, '2025-01-01', NULL)`,
  ).run();
  for (const metric of ["sleep_h", "steps"]) {
    db.prepare(
      `INSERT INTO findings (metric, state, asof_day, stint_id)
       VALUES (?, 'computed', '2026-01-20', ?)`,
    ).run(metric, metric === "steps" ? 2 : 1);
    for (let index = 0; index < 35; index++) {
      const day = new Date(Date.parse("2025-12-17T00:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      db.prepare(
        `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
      ).run(
        metric,
        metric === "steps" ? 2 : 1,
        day,
        metric === "steps" ? "day" : "night",
        10 + index,
      );
    }
  }
  return db;
}

describe("ranked findings", () => {
  test("B-F7 ranks overnight findings, filters daytime within rows, and excludes trend-only", () => {
    const db = makeDb();
    const rows = rebuildFindings(db, [
      baseline("steps", "within", 0.2),
      baseline("vo2max", "alert", 9),
      baseline("sleep_h", "alert", 3),
      baseline("wrist_temp", "notable", 2),
    ]);
    expect(rows.map((row) => row.metric)).toEqual(["sleep_h", "wrist_temp"]);
    expect(rows[0]?.direction).toBe("higher");
    expect(rows[0]?.severity).toBe("alert");
    expect(rows[0]?.sparkline).toHaveLength(35);
    expect(JSON.stringify(rows).toLowerCase()).not.toMatch(/caused|better|worse/);
    const checksJson = db
      .query("SELECT checks_json AS checks FROM findings WHERE metric = 'sleep_h'")
      .get() as { checks: string };
    expect(Array.isArray(JSON.parse(checksJson.checks))).toBe(true);
    db.close();
  });
});
