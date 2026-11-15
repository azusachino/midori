import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { addDays } from "../domain/dates";
import { deriveSeamSteps } from "./seams";
import type { MetricUnit } from "./stints";
import { deriveStints, minorEpochs, primaryUnits, rebuildStints } from "./stints";

const alwaysUsable = () => true;
function unit(
  epochId: number,
  epochKind: MetricUnit["epochKind"],
  unitDay: string,
  n = 1,
): MetricUnit {
  return {
    metric: "steps",
    epochId,
    epochKind,
    unitDay,
    unitKind: "day",
    value: epochId * 100 + n,
    n,
  };
}
function days(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

describe("stints and primary epochs", () => {
  test("B-D3 minor app single sample → no seam", () => {
    const rows = [unit(1, "app", "2026-01-01")];
    expect(minorEpochs(rows)).toEqual(new Set([1]));
    const stints = deriveStints(rows, alwaysUsable);
    expect(stints).toEqual([]);
    expect(deriveSeamSteps(stints, rows, alwaysUsable)).toEqual([]);
  });

  test("B-D4 alternating phone/watch step days → no seam", () => {
    const rows = days("2026-01-01", 28).map((day, index) =>
      unit(index % 2 ? 2 : 1, index % 2 ? "watch" : "phone", day),
    );
    const stints = deriveStints(rows, alwaysUsable);
    expect(stints).toHaveLength(1);
    expect(deriveSeamSteps(stints, rows, alwaysUsable)).toEqual([]);
  });

  test("B-D4/B-D5/B-D7 watch replaced by same-kind watch → step seam at first unit of the 7-run", () => {
    const oldDays = days("2026-01-01", 14);
    const newDays = days("2026-01-15", 7);
    const rows = [
      ...oldDays.map((day) => unit(1, "watch", day)),
      ...newDays.map((day) => unit(2, "watch", day)),
    ];
    const stints = deriveStints(rows, alwaysUsable);
    expect(stints).toEqual([
      { metric: "steps", epochId: 1, startDay: "2026-01-01", endDay: "2026-01-14" },
      { metric: "steps", epochId: 2, startDay: "2026-01-15", endDay: null },
    ]);
    expect(deriveSeamSteps(stints, rows, alwaysUsable)).toEqual([
      { metric: "steps", seamDay: "2026-01-15", kind: "step", value: 100, nOld: 14, nNew: 7 },
    ]);
  });

  test("B-D6 shared usable units produce an offset without changing values", () => {
    const rows = [
      ...days("2026-01-01", 14).map((day) => unit(1, "watch", day)),
      ...days("2026-01-08", 14).map((day) => unit(2, "watch", day)),
    ];
    const before = rows.map((row) => row.value);
    const seam = deriveSeamSteps(
      [
        { metric: "steps", epochId: 1, startDay: "2026-01-01", endDay: "2026-01-14" },
        { metric: "steps", epochId: 2, startDay: "2026-01-15", endDay: null },
      ],
      rows,
      alwaysUsable,
    );
    expect(seam).toEqual([
      { metric: "steps", seamDay: "2026-01-15", kind: "offset", value: 100, nOld: 7, nNew: 7 },
    ]);
    expect(rows.map((row) => row.value)).toEqual(before);
  });

  test("B-D4b primary absence has no fallback value", () => {
    const rows = [
      ...days("2026-01-01", 14).map((day) => unit(1, "watch", day)),
      ...days("2026-01-15", 14).map((day) => unit(2, "phone", day)),
    ];
    const stints = deriveStints(rows, alwaysUsable);
    const selected = primaryUnits(stints, rows);
    expect(selected.some((row) => row.unitDay === "2026-01-15" && row.epochId === 1)).toBe(false);
    expect(selected.some((row) => row.unitDay === "2026-01-15" && row.epochId === 2)).toBe(true);
  });

  test("B-D4 stints are persisted", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      "INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES ('watch', 'Watch1,1', 'watch', '2026-01-01', '2026-01-10', 10)",
    ).run();
    const insert = db.prepare(
      "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES ('steps', 1, ?, 'day', 100, 1, 1)",
    );
    for (const day of days("2026-01-01", 10)) insert.run(day);
    expect(rebuildStints(db, alwaysUsable)).toEqual([
      { metric: "steps", epochId: 1, startDay: "2026-01-01", endDay: null },
    ]);
    expect(db.query("SELECT metric, epoch_id AS epochId FROM stints").all()).toEqual([
      { metric: "steps", epochId: 1 },
    ]);
    db.close();
  });
});
