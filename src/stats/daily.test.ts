import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/db";
import { computeDailyMetrics } from "./daily";

const tmp = resolve(import.meta.dir, "../../.tmp-daily-test");
const runId = randomUUID().slice(0, 8);
let seq = 0;

interface InsertRecord {
  type: string;
  source: string;
  startLocal: string; // 'YYYY-MM-DD HH:MM:SS' JST (+09:00)
  endLocal?: string;
  value?: number | null;
  valueStr?: string | null;
}

const JST = 9 * 60;

/** local JST time -> utcIso, mirroring the mapper's storage format. */
function jstToUtc(local: string): { utc: string; day: string; minute: number } {
  const [dayRaw, time] = local.split(" ");
  if (!time || !dayRaw) throw new Error(`bad test time: ${local}`);
  const day = dayRaw;
  const parts = time.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const utcMs = Date.parse(`${day}T${time}+09:00`);
  return {
    utc: new Date(utcMs).toISOString(),
    day,
    minute: h * 60 + m,
  };
}

function insertRecords(db: Database, importId: number, rows: InsertRecord[]): void {
  db.prepare(
    `INSERT INTO imports (id, created_at, zip_name, zip_size, status)
     VALUES (?, ?, 'test.zip', 1, 'done')
     ON CONFLICT(id) DO NOTHING`,
  ).run(importId, new Date().toISOString());
  const insert = db.prepare(
    `INSERT INTO records
       (type, source_name, unit, start_at, end_at, start_offset_min, end_offset_min, value, value_str, import_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    const start = jstToUtc(r.startLocal);
    const end = jstToUtc(r.endLocal ?? r.startLocal);
    insert.run(
      r.type,
      r.source,
      "count",
      start.utc,
      end.utc,
      JST,
      JST,
      r.value ?? null,
      r.valueStr ?? null,
      importId,
    );
  }
}

interface DailyRow {
  metric: string;
  source_name: string;
  day: string;
  method: string;
  value: number;
  sample_count: number;
}

function daily(db: Database, metric: string): DailyRow[] {
  return db
    .prepare("SELECT * FROM daily_metrics WHERE metric = ? ORDER BY day, source_name")
    .all(metric) as unknown as DailyRow[];
}

function freshDb(): { db: Database; path: string } {
  const path = `${tmp}/db-${runId}-${seq++}.sqlite`;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${path}${suffix}`);
    } catch {
      // absent — fine
    }
  }
  return { db: openDb(path), path };
}

const paths: string[] = [];

beforeAll(async () => {
  await Bun.write(`${tmp}/.keep`, "");
});

afterAll(() => {
  for (const p of paths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(`${p}${suffix}`);
      } catch {
        // absent — fine
      }
    }
  }
});

describe("daily metrics: median family", () => {
  test("median over same-day samples, per source", () => {
    const { db, path } = freshDb();
    paths.push(path);
    insertRecords(db, 1, [
      // watch: 3 RHR samples on 2026-01-10 -> median 60
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-10 08:00:00",
        value: 58,
      },
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-10 12:00:00",
        value: 62,
      },
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-10 20:00:00",
        value: 60,
      },
      // phone: 2 samples on same day -> median (59+61)/2 = 60
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "phone",
        startLocal: "2026-01-10 09:00:00",
        value: 59,
      },
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "phone",
        startLocal: "2026-01-10 10:00:00",
        value: 61,
      },
    ]);
    const summary = computeDailyMetrics(db, 1);
    expect(summary.rows).toBeGreaterThan(0);
    const rows = daily(db, "rhr");
    expect(rows.length).toBe(2);
    const watch = rows.find((r) => r.source_name === "watch");
    expect(watch?.day).toBe("2026-01-10");
    expect(watch?.value).toBe(60);
    expect(watch?.sample_count).toBe(3);
    expect(watch?.method).toBe("median");
    const phone = rows.find((r) => r.source_name === "phone");
    expect(phone?.value).toBe(60);
    expect(phone?.sample_count).toBe(2);
    db.close();
  });

  test("local day boundary follows record-local midnight, not UTC", () => {
    const { db, path } = freshDb();
    paths.push(path);
    insertRecords(db, 1, [
      // 2026-01-10 23:30 JST = 2026-01-10 14:30 UTC -> local day 01-10
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-10 23:30:00",
        value: 70,
      },
      // 2026-01-11 00:10 JST = 2026-01-10 15:10 UTC -> local day 01-11
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-11 00:10:00",
        value: 71,
      },
    ]);
    computeDailyMetrics(db, 1);
    const rows = daily(db, "rhr");
    expect(rows.map((r) => r.day)).toEqual(["2026-01-10", "2026-01-11"]);
    db.close();
  });
});

describe("daily metrics: sum family", () => {
  test("steps sum within a day; missing days stay missing (no zero-fill)", () => {
    const { db, path } = freshDb();
    paths.push(path);
    insertRecords(db, 1, [
      {
        type: "HKQuantityTypeIdentifierStepCount",
        source: "phone",
        startLocal: "2026-01-10 09:00:00",
        value: 1200,
      },
      {
        type: "HKQuantityTypeIdentifierStepCount",
        source: "phone",
        startLocal: "2026-01-10 18:00:00",
        value: 800,
      },
      // gap day 01-11 entirely absent, then one sample on 01-12
      {
        type: "HKQuantityTypeIdentifierStepCount",
        source: "phone",
        startLocal: "2026-01-12 10:00:00",
        value: 50,
      },
    ]);
    computeDailyMetrics(db, 1);
    const rows = daily(db, "steps");
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      day: "2026-01-10",
      value: 2000,
      sample_count: 2,
      method: "sum",
    });
    expect(rows[1]).toMatchObject({ day: "2026-01-12", value: 50, sample_count: 1 });
    db.close();
  });
});

describe("daily metrics: night-only filter (HRV)", () => {
  test("uses negative record offsets to derive the local date and time", () => {
    const { db, path } = freshDb();
    paths.push(path);
    const type = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN";
    insertRecords(db, 1, [{ type, source: "west", startLocal: "2026-01-11 09:00:00", value: 42 }]);
    db.prepare(
      "UPDATE records SET start_at = ?, end_at = ?, start_offset_min = ?, end_offset_min = ?",
    ).run("2026-01-11T04:30:00.000Z", "2026-01-11T04:30:00.000Z", -300, -300);
    computeDailyMetrics(db, 1);
    expect(daily(db, "hrv_sdnn")).toMatchObject([
      { day: "2026-01-10", value: 42, sample_count: 1 },
    ]);
    db.close();
  });
  test("keeps 21:00–09:00 samples, drops daytime samples", () => {
    const { db, path } = freshDb();
    paths.push(path);
    const T = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN";
    insertRecords(db, 1, [
      // night of 01-10: 22:00 on the 10th and 02:00 on the 11th both count
      { type: T, source: "watch", startLocal: "2026-01-10 22:00:00", value: 50 },
      { type: T, source: "watch", startLocal: "2026-01-11 02:00:00", value: 60 },
      // 21:00 is inclusive; 09:00 is exclusive.
      { type: T, source: "watch", startLocal: "2026-01-10 21:00:00", value: 45 },
      { type: T, source: "watch", startLocal: "2026-01-11 08:59:59", value: 55 },
      { type: T, source: "watch", startLocal: "2026-01-11 09:00:00", value: 996 },
      // daytime dropped: 20:59 and 09:01
      { type: T, source: "watch", startLocal: "2026-01-10 20:59:00", value: 999 },
      { type: T, source: "watch", startLocal: "2026-01-11 09:01:00", value: 998 },
      { type: T, source: "watch", startLocal: "2026-01-11 09:00:01", value: 997 },
      // daytime for a non-nightOnly metric stays: RHR at 12:00
      {
        type: "HKQuantityTypeIdentifierRestingHeartRate",
        source: "watch",
        startLocal: "2026-01-11 12:00:00",
        value: 60,
      },
    ]);
    computeDailyMetrics(db, 1);
    const hrv = daily(db, "hrv_sdnn");
    // day 01-10: 21:00(45), 22:00(50); day 01-11: 02:00(60), 08:59:59(55).
    expect(hrv.length).toBe(2);
    expect(hrv[0]).toMatchObject({ day: "2026-01-10", value: 47.5, sample_count: 2 });
    expect(hrv[1]).toMatchObject({ day: "2026-01-11", value: 57.5, sample_count: 2 });
    // the dropped daytime samples must not appear anywhere
    expect(hrv.every((r) => r.value < 900)).toBe(true);
    const rhr = daily(db, "rhr");
    expect(rhr.length).toBe(1); // 12:00 sample kept for a day metric
    db.close();
  });
});

describe("daily metrics: sleep family from nights", () => {
  test("sleep_h/deep_h/rem_h from dominant source, night-dated", () => {
    const { db, path } = freshDb();
    paths.push(path);
    const S = "HKCategoryTypeIdentifierSleepAnalysis";
    const insertSleep = (stage: string, startLocal: string, hours: number, source = "watch") => {
      const [d, t] = startLocal.split(" ");
      const startMin = Number(t?.slice(0, 2) ?? "0") * 60 + Number(t?.slice(3, 5) ?? "0");
      const endMin = startMin + hours * 60;
      const endDate = new Date(
        Date.parse(`${d}T00:00:00Z`) + Math.floor(endMin / 1440) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const endLocal = `${endDate} ${String(Math.floor((endMin % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(endMin % 60)).padStart(2, "0")}:00`;
      insertRecords(db, 1, [
        {
          type: S,
          source,
          startLocal,
          endLocal,
          valueStr: stage,
        },
      ]);
    };
    // Night 2026-01-10 (starts 23:00 on the 10th, ends past midnight):
    // core 4h (23:00-03:00 crosses midnight), deep 1.5h, REM 1h, plus phone noise
    insertSleep("HKCategoryValueSleepAnalysisAsleepCore", "2026-01-10 23:00:00", 4);
    insertSleep("HKCategoryValueSleepAnalysisAsleepDeep", "2026-01-11 03:00:00", 1.5);
    insertSleep("HKCategoryValueSleepAnalysisAsleepREM", "2026-01-11 04:30:00", 1);
    // a phone record same night, small — must not win dominance
    insertSleep("HKCategoryValueSleepAnalysisAsleepCore", "2026-01-11 02:00:00", 0.5, "phone");
    computeDailyMetrics(db, 1);

    const sleep = daily(db, "sleep_h");
    expect(sleep.length).toBe(1);
    expect(sleep[0]).toMatchObject({
      day: "2026-01-10",
      source_name: "watch",
      value: 6.5,
      method: "sum",
    });
    const deep = daily(db, "deep_h");
    expect(deep[0]).toMatchObject({ day: "2026-01-10", value: 1.5 });
    const rem = daily(db, "rem_h");
    expect(rem[0]).toMatchObject({ day: "2026-01-10", value: 1 });
    // phone contributed no sleep row (lost dominance)
    expect(sleep.every((r) => r.source_name === "watch")).toBe(true);
    db.close();
  });
});

describe("daily metrics: recompute lifecycle", () => {
  test("recompute is wholesale: stale rows from earlier imports vanish", () => {
    const { db, path } = freshDb();
    paths.push(path);
    const T = "HKQuantityTypeIdentifierStepCount";
    insertRecords(db, 1, [
      { type: T, source: "phone", startLocal: "2026-01-10 09:00:00", value: 100 },
      { type: T, source: "phone", startLocal: "2026-01-11 09:00:00", value: 200 },
    ]);
    computeDailyMetrics(db, 1);
    expect(daily(db, "steps").length).toBe(2);
    // New import adds nothing; recompute must not duplicate or resurrect.
    db.prepare(
      `INSERT INTO imports (id, created_at, zip_name, zip_size, status)
       VALUES (2, ?, 'test.zip', 1, 'done')`,
    ).run(new Date().toISOString());
    computeDailyMetrics(db, 2);
    const rows = daily(db, "steps");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.value > 0)).toBe(true);
    db.close();
  });
});
