import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { addDays } from "../domain/dates";
import { derive } from "./derive";

let db: Database;

afterEach(() => db?.close());

function freshDb(exportDate = "2026-03-01 12:00:00 +0000"): Database {
  db = new Database(":memory:");
  applyMigrations(db);
  db.run(
    "INSERT INTO imports (created_at, zip_name, zip_size, status, export_date) VALUES (?, ?, ?, 'done', ?)",
    ["2026-03-01T00:00:00.000Z", "synthetic.zip", 1, exportDate],
  );
  return db;
}

function record(
  type: string,
  day: string,
  value: number | null,
  hardware: string | null,
  source = "Synthetic Source",
  minute = 20 * 60,
  extra: { valueStr?: string; metaJson?: string } = {},
): void {
  const start = new Date(Date.parse(`${day}T00:00:00.000Z`) + minute * 60_000).toISOString();
  const end = new Date(Date.parse(start) + 60_000).toISOString();
  db.run(
    `INSERT INTO records (type, source_name, start_at, end_at, start_offset_min, end_offset_min,
      value, value_str, import_id, device_hw, meta_json)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1, ?, ?)`,
    [type, source, start, end, value, extra.valueStr ?? null, hardware, extra.metaJson ?? null],
  );
}

function addSteps(day: string, value: number, hw: string, source = "Synthetic Source"): void {
  record("HKQuantityTypeIdentifierStepCount", day, value, hw, source, 12 * 60);
}

function addSleep(day: string, hw: string | null = "Watch1,1", source = "Synthetic Watch"): void {
  record("HKCategoryTypeIdentifierSleepAnalysis", day, null, hw, source, 23 * 60, {
    valueStr: "HKCategoryValueSleepAnalysisAsleepCore",
  });
}

function addSleepSpan(from: string, count: number, hw: string | null = "Watch1,1"): string[] {
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  for (const day of days) addSleep(day, hw);
  return days;
}

function finding(metric: string) {
  return derive(db).findings.find((row) => row.metric === metric);
}

describe("Gate A production-path regressions", () => {
  test("B-D6 H1 keeps shared non-primary presence for a seam offset", () => {
    freshDb();
    const oldDays = Array.from({ length: 14 }, (_, i) => addDays("2026-01-01", i));
    const newDays = Array.from({ length: 14 }, (_, i) => addDays("2026-01-08", i));
    for (const day of oldDays) addSteps(day, 1000, "iPhone1,1");
    for (const day of newDays) addSteps(day, 1250, "Watch1,1");
    derive(db);
    expect(
      db.query("SELECT COUNT(*) AS count FROM metric_values WHERE metric = 'steps'").get(),
    ).toEqual({ count: 28 });
    expect(
      db.query("SELECT kind, value, n_old, n_new FROM seam_steps WHERE metric = 'steps'").get(),
    ).toEqual({ kind: "offset", value: 250, n_old: 7, n_new: 7 });
  });

  test("B-D3 M1 minor epochs cannot become the fallback initial primary", () => {
    freshDb();
    for (const day of ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"])
      addSteps(day, 100, "OtherDevice");
    for (const day of Array.from({ length: 7 }, (_, i) => addDays("2026-01-20", i)))
      addSteps(day, 200, "Watch1,1");
    derive(db);
    expect(
      db
        .query(
          "SELECT e.device_hw FROM stints s JOIN epochs e ON e.id = s.epoch_id WHERE s.metric = 'steps'",
        )
        .get(),
    ).toEqual({ device_hw: "Watch1,1" });
  });

  test("B-C3 M2 flags metric-level unusable units skipped around the recent window", () => {
    freshDb("2026-02-20 12:00:00 +0000");
    const days = addSleepSpan("2026-01-01", 50);
    for (const day of days) {
      const samples = day === "2026-02-18" ? [0, 1] : [0, 1, 2];
      for (const sample of samples)
        record(
          "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
          day,
          40 + sample,
          "Watch1,1",
          "Synthetic Watch",
          2 * 60 + sample,
        );
    }
    derive(db);
    expect(
      finding("hrv_sdnn")?.checks.find((check) => check.key === "partial_nights")?.flagged,
    ).toBe(true);
  });

  test("B-C1 M3 flags a stint boundary without a seam-step row", () => {
    freshDb();
    const oldDays = Array.from({ length: 14 }, (_, i) => addDays("2026-01-01", i));
    const newDays = Array.from({ length: 14 }, (_, i) => addDays("2026-01-15", i));
    addSleepSpan("2026-01-01", 35);
    for (const day of oldDays) addSteps(day, 1000, "iPhone1,1");
    for (const [index, day] of newDays.entries())
      addSteps(day, index < 7 ? 1800 : 2500, "Watch1,1");
    derive(db);
    expect(finding("steps")?.checks.find((check) => check.key === "device_change")?.flagged).toBe(
      true,
    );
  });

  test("B-F11 M4 reports onset from z direction when newest unit is inside the band", () => {
    freshDb("2026-02-10 12:00:00 +0000");
    const days = Array.from({ length: 35 }, (_, i) => addDays("2026-01-01", i));
    addSleepSpan("2026-01-01", 35);
    for (const [index, day] of days.entries())
      addSteps(day, index < 28 ? 1000 : index === 34 ? 1000 : 1800, "Watch1,1");
    derive(db);
    expect(finding("steps")?.onset?.day).toBe("2026-01-29");
  });

  test("B-D2 M5 inherits each device-less record from its nearest device run", () => {
    freshDb();
    record(
      "HKQuantityTypeIdentifierStepCount",
      "2026-01-01",
      100,
      "WatchOld,1",
      "Synthetic Watch",
      6 * 60,
    );
    record(
      "HKQuantityTypeIdentifierStepCount",
      "2026-01-02",
      100,
      "WatchNew,1",
      "Synthetic Watch",
      6 * 60,
    );
    addSleep("2025-12-31", "WatchOld,1");
    addSleep("2026-01-01", "WatchOld,1");
    addSleep("2026-01-02", "WatchNew,1");
    record(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "2026-01-01",
      55,
      null,
      "Synthetic Watch",
      7 * 60,
    );
    record(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "2026-01-02",
      60,
      null,
      "Synthetic Watch",
      7 * 60,
    );
    derive(db);
    expect(
      db
        .query(
          "SELECT e.device_hw AS hardware, mv.unit_day AS day FROM metric_values mv JOIN epochs e ON e.id=mv.epoch_id WHERE mv.metric='rhr' ORDER BY day",
        )
        .all(),
    ).toEqual([
      { hardware: "WatchOld,1", day: "2025-12-31" },
      { hardware: "WatchNew,1", day: "2026-01-01" },
    ]);
  });

  test("B-N8 M7 compares UTC offsets when timezone identifiers differ", () => {
    freshDb();
    for (const [day, zone] of [
      ["2026-01-01", "America/Los_Angeles"],
      ["2026-01-02", "Etc/GMT+8"],
    ] as const)
      record(
        "HKCategoryTypeIdentifierSleepAnalysis",
        day,
        null,
        "Watch1,1",
        "Synthetic Watch",
        23 * 60,
        {
          valueStr: "HKCategoryValueSleepAnalysisAsleepCore",
          metaJson: JSON.stringify({ HKTimeZone: zone }),
        },
      );
    derive(db);
    expect(db.query("SELECT SUM(tz_change) AS count FROM nights").get()).toEqual({ count: 0 });
  });

  test("B-N9 L1 assigns resting heart rate to the preceding local calendar day", () => {
    freshDb();
    addSleep("2026-01-01");
    record(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "2026-01-02",
      55,
      "Watch1,1",
      "Synthetic Watch",
      13 * 60,
    );
    derive(db);
    expect(db.query("SELECT unit_day AS day FROM metric_values WHERE metric='rhr'").get()).toEqual({
      day: "2026-01-01",
    });
  });

  test("B-C5 L2 flags eleven inclusive calendar units but not ten", () => {
    freshDb("2026-02-10 12:00:00 +0000");
    addSleepSpan("2026-01-01", 40);
    for (const day of [
      "2026-01-30",
      "2026-02-01",
      "2026-02-03",
      "2026-02-05",
      "2026-02-07",
      "2026-02-08",
      "2026-02-09",
    ])
      addSteps(day, 1800, "Watch1,1");
    derive(db);
    const elevenDayChecks = JSON.parse(
      (
        db.query("SELECT checks_json AS checks FROM findings WHERE metric='steps'").get() as {
          checks: string;
        }
      ).checks,
    ) as Array<{ key: string; flagged: boolean }>;
    expect(elevenDayChecks.find((check) => check.key === "missing_nights")?.flagged).toBe(true);
    db.close();
    freshDb("2026-02-10 12:00:00 +0000");
    addSleepSpan("2026-01-01", 40);
    for (const day of [
      "2026-01-31",
      "2026-02-02",
      "2026-02-04",
      "2026-02-06",
      "2026-02-07",
      "2026-02-08",
      "2026-02-09",
    ])
      addSteps(day, 1800, "Watch1,1");
    derive(db);
    const tenDayChecks = JSON.parse(
      (
        db.query("SELECT checks_json AS checks FROM findings WHERE metric='steps'").get() as {
          checks: string;
        }
      ).checks,
    ) as Array<{ key: string; flagged: boolean }>;
    expect(tenDayChecks.find((check) => check.key === "missing_nights")?.flagged).toBe(false);
  });

  test("B-N9 L3 persists export-day measurements as unusable", () => {
    freshDb("2026-02-01 12:00:00 +0000");
    addSleepSpan("2026-01-01", 7);
    addSteps("2026-02-01", 1000, "Watch1,1");
    derive(db);
    expect(
      db
        .query("SELECT usable FROM metric_values WHERE metric='steps' AND unit_day='2026-02-01'")
        .get(),
    ).toEqual({ usable: 0 });
  });

  test("B-D4 L4 equal app/other rank picks the earliest qualifying run then lowest epoch id", () => {
    freshDb();
    for (let i = 0; i < 14; i++) addSteps(addDays("2026-01-01", i), 1000, "", "A App");
    for (let i = 14; i < 21; i++) {
      const day = addDays("2026-01-01", i);
      addSteps(day, 1200, "OtherModel", "B Other");
      addSteps(day, 1200, "", "C App");
    }
    derive(db);
    expect(
      db
        .query(`SELECT e.source_name AS source FROM stints s JOIN epochs e ON e.id=s.epoch_id
          WHERE s.metric='steps' ORDER BY s.start_day`)
        .all(),
    ).toEqual([{ source: "A App" }, { source: "B Other" }]);
  });

  test("B-F5 L5 derives severity through the production baseline", () => {
    freshDb("2026-02-10 12:00:00 +0000");
    addSleepSpan("2026-01-01", 35);
    for (let i = 0; i < 35; i++)
      addSteps(addDays("2026-01-01", i), i < 28 ? 1000 : 2200, "Watch1,1");
    derive(db);
    expect(finding("steps")?.severity).toBe("alert");
  });

  test("B-F9 L6 uses neutral higher/lower wording direction in the derived row", () => {
    freshDb("2026-02-10 12:00:00 +0000");
    addSleepSpan("2026-01-01", 35);
    for (let i = 0; i < 35; i++)
      addSteps(addDays("2026-01-01", i), i < 28 ? 1000 : 1800, "Watch1,1");
    derive(db);
    expect(finding("steps")?.direction).toBe("higher");
  });

  test("B-F10 L7 charts trend-only values without persisting a finding", () => {
    freshDb();
    for (const [i, day] of Array.from(
      { length: 8 },
      (_, i) => [i, addDays("2026-01-01", i)] as const,
    )) {
      addSleep(day);
      record("HKQuantityTypeIdentifierVO2Max", day, 40 + i, "Watch1,1", "Synthetic Watch", 12 * 60);
    }
    const result = derive(db);
    expect(
      db.query("SELECT COUNT(*) AS count FROM metric_values WHERE metric='vo2max'").get(),
    ).toEqual({ count: 8 });
    expect(db.query("SELECT COUNT(*) AS count FROM findings WHERE metric='vo2max'").get()).toEqual({
      count: 0,
    });
    expect(result.findings.some((row) => row.metric === "vo2max")).toBe(false);
  });

  test("B-D2b assigns device-less sources that never carry device as app epochs", () => {
    freshDb();
    for (const day of Array.from({ length: 7 }, (_, i) => addDays("2026-01-01", i)))
      record("HKQuantityTypeIdentifierStepCount", day, 50, null, "Manual Entry", 12 * 60);
    derive(db);
    expect(db.query("SELECT kind FROM epochs WHERE source_name='Manual Entry'").get()).toEqual({
      kind: "app",
    });
  });

  test("B-D5 persists every primary transition as a stint boundary", () => {
    freshDb();
    for (const day of Array.from({ length: 14 }, (_, i) => addDays("2026-01-01", i)))
      addSteps(day, 1000, "iPhone1,1");
    for (const day of Array.from({ length: 7 }, (_, i) => addDays("2026-01-15", i)))
      addSteps(day, 1000, "Watch1,1");
    derive(db);
    expect(
      db.query("SELECT start_day FROM stints WHERE metric='steps' ORDER BY start_day").all(),
    ).toEqual([{ start_day: "2026-01-01" }, { start_day: "2026-01-15" }]);
  });

  test("B-D7 reports an across-seam step when the primary epochs do not overlap", () => {
    freshDb();
    for (const day of Array.from({ length: 14 }, (_, i) => addDays("2026-01-01", i)))
      addSteps(day, 1000, "WatchOld,1");
    for (const day of Array.from({ length: 14 }, (_, i) => addDays("2026-01-15", i)))
      addSteps(day, 1200, "WatchNew,1");
    derive(db);
    expect(db.query("SELECT kind, value FROM seam_steps WHERE metric='steps'").get()).toEqual({
      kind: "step",
      value: 200,
    });
  });

  test("B-I4 H2 an older completed export cannot move as-of backward", () => {
    freshDb("2026-02-10 12:00:00 +0000");
    addSleepSpan("2026-01-01", 40);
    const first = derive(db);
    db.run(
      "INSERT INTO imports (created_at, zip_name, zip_size, status, export_date) VALUES (?, ?, ?, 'done', ?)",
      ["2026-02-11T00:00:00.000Z", "older.zip", 1, "2026-01-20 12:00:00 +0000"],
    );
    const second = derive(db);
    expect(second.asOfDay).toBe(first.asOfDay);
    expect(second.asOfDay).toBe("2026-02-09");
  });

  test("B-D1 same-name hardware changes produce separate epochs in the production derive", () => {
    freshDb();
    addSteps("2026-01-01", 500, "iPhone1,1", "Same Source");
    addSteps("2026-01-02", 600, "Watch1,1", "Same Source");
    derive(db);
    expect(db.query("SELECT device_hw, kind FROM epochs ORDER BY device_hw").all()).toEqual([
      { device_hw: "Watch1,1", kind: "watch" },
      { device_hw: "iPhone1,1", kind: "phone" },
    ]);
  });

  test("B-N4 joins a near continuation after 09:00 to its existing sleep night", () => {
    freshDb();
    record(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "2026-01-01",
      null,
      "Watch1,1",
      "Synthetic Watch",
      23 * 60,
      {
        valueStr: "HKCategoryValueSleepAnalysisAsleepCore",
      },
    );
    db.run("UPDATE records SET end_at = '2026-01-02T10:00:00.000Z' WHERE id = 1");
    record(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "2026-01-02",
      null,
      "Watch1,1",
      "Synthetic Watch",
      10 * 60 + 30,
      {
        valueStr: "HKCategoryValueSleepAnalysisAsleepCore",
      },
    );
    addSleepSpan("2026-01-02", 6);
    derive(db);
    expect(db.query("SELECT date, asleep_s FROM nights WHERE date='2026-01-01'").all()).toEqual([
      { date: "2026-01-01", asleep_s: 39_660 },
    ]);
  });

  test("B-N5 assigns HRV only within 21:00–09:00 local time in the production derive", () => {
    freshDb();
    addSleep("2026-01-01");
    for (const [minute, value] of [
      [20 * 60 + 59, 30],
      [21 * 60, 40],
      [9 * 60, 50],
    ] as const)
      record(
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
        "2026-01-01",
        value,
        "Watch1,1",
        "Synthetic Watch",
        minute,
      );
    derive(db);
    expect(db.query("SELECT n, value FROM metric_values WHERE metric='hrv_sdnn'").get()).toEqual({
      n: 1,
      value: 40,
    });
  });

  test("B-N2 assigns sleep records starting at or after 15:00 to that night", () => {
    freshDb();
    addSleep("2026-01-01", "Watch1,1", "Synthetic Watch");
    derive(db);
    expect(db.query("SELECT date FROM nights").get()).toEqual({ date: "2026-01-01" });
  });

  test("B-N3 assigns sleep records before 09:00 to the previous night", () => {
    freshDb();
    record(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "2026-01-02",
      null,
      "Watch1,1",
      "Synthetic Watch",
      8 * 60,
      { valueStr: "HKCategoryValueSleepAnalysisAsleepCore" },
    );
    derive(db);
    expect(db.query("SELECT date FROM nights").get()).toEqual({ date: "2026-01-01" });
  });
});
