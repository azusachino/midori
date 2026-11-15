import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { boundarySpec } from "../../tests/fixtures/boundary";
import { generalSpec, SLEEP_APP, WATCH } from "../../tests/fixtures/general";
import { SLEEP_VALUE } from "../../tests/fixtures/model";
import { applyMigrations } from "../db/db";
import { instantInZone, parseHealthKitDate, zoneLocalToUtc } from "../domain/dates";
import {
  assembleNights,
  continuesNight,
  exportCutReason,
  inHrvNightWindow,
  nightKeyForSleepRecord,
  rebuildNightPipeline,
  type SleepRecordInput,
  type SleepStage,
} from "./nights";

const STAGE_OF: Record<string, SleepStage> = {
  [SLEEP_VALUE.inBed]: "inBed",
  [SLEEP_VALUE.core]: "asleepCore",
  [SLEEP_VALUE.deep]: "asleepDeep",
  [SLEEP_VALUE.rem]: "asleepREM",
  [SLEEP_VALUE.awake]: "awake",
};

/** Builds SleepRecordInputs from a fixture spec's sleep records via the production date parser. */
function sleepInputs(spec: ReturnType<typeof boundarySpec>): SleepRecordInput[] {
  const out: SleepRecordInput[] = [];
  for (const r of spec.records) {
    if (r.type !== "HKCategoryTypeIdentifierSleepAnalysis") continue;
    const start = parseHealthKitDate(r.startDate);
    const end = parseHealthKitDate(r.endDate);
    if (!start.ok || !end.ok) throw new Error(`bad fixture date: ${r.startDate}`);
    const stage = STAGE_OF[r.value ?? ""];
    if (stage === undefined) continue; // valueless category record: not a stage
    out.push({
      source: r.sourceName,
      stage,
      startUtcIso: start.date.utcIso,
      endUtcIso: end.date.utcIso,
      startLocalDay: start.date.localDay,
      startLocalMinute: start.date.localMinute,
    });
  }
  return out;
}

function rec(
  source: string,
  stage: SleepStage,
  startLocalDay: string,
  startLocalMinute: number,
  startUtcIso: string,
  endUtcIso: string,
): SleepRecordInput {
  return { source, stage, startUtcIso, endUtcIso, startLocalDay, startLocalMinute };
}

describe("night boundaries (B-N2, B-N3)", () => {
  test("boundary minutes: 14:59 nap, 15:00 same date, 08:59 previous, 09:00 nap", () => {
    expect(nightKeyForSleepRecord("2026-01-10", 899)).toBeNull();
    expect(nightKeyForSleepRecord("2026-01-10", 900)).toBe("2026-01-10");
    expect(nightKeyForSleepRecord("2026-01-11", 539)).toBe("2026-01-10");
    expect(nightKeyForSleepRecord("2026-01-11", 540)).toBeNull();
  });

  test("21:00 belongs to its own date; midnight rolls to previous date", () => {
    expect(nightKeyForSleepRecord("2026-01-10", 21 * 60)).toBe("2026-01-10");
    expect(nightKeyForSleepRecord("2026-01-01", 0)).toBe("2025-12-31");
  });

  test("12:00 start is a nap", () => {
    expect(nightKeyForSleepRecord("2026-01-06", 12 * 60)).toBeNull();
  });

  test("B-N4 09:00–12:00 sleep continues within 60 minutes; later sleep is a nap", () => {
    const end = "2026-01-11T16:00:00.000Z";
    expect(continuesNight("2026-01-11T17:00:00.000Z", end)).toBe(true);
    expect(continuesNight("2026-01-11T17:00:01.000Z", end)).toBe(false);
    expect(continuesNight("2026-01-11T15:59:59.000Z", end)).toBe(false);
    expect(continuesNight("2026-01-11T17:00:00.000Z", null)).toBe(false);
  });

  test("B-N5 HRV window includes 21:00 and excludes 09:00", () => {
    expect(inHrvNightWindow(20 * 60 + 59)).toBe(false);
    expect(inHrvNightWindow(21 * 60)).toBe(true);
    expect(inHrvNightWindow(8 * 60 + 59)).toBe(true);
    expect(inHrvNightWindow(9 * 60)).toBe(false);
  });
});

describe("night timezone and completeness (B-N1, B-N6, B-N8)", () => {
  test("B-N1 IANA zone controls local assignment across an export-offset date boundary", () => {
    expect(instantInZone("2026-01-11T01:00:00.000Z", "America/Los_Angeles")).toEqual({
      localDay: "2026-01-10",
      localMinute: 17 * 60,
    });
    expect(zoneLocalToUtc("2026-01-11", 12 * 60, "America/Los_Angeles")).toBe(
      Date.parse("2026-01-11T20:00:00.000Z"),
    );
  });

  test("B-N6 only an export cut makes a night partial; short nights stay complete", () => {
    expect(exportCutReason("2026-01-10", "UTC+09:00", "2026-01-11T02:59:59.000Z")).toBe(
      "export_cut",
    );
    expect(exportCutReason("2026-01-10", "UTC+09:00", "2026-01-11T03:00:00.000Z")).toBeNull();
    expect(exportCutReason("2026-01-10", "UTC+09:00", null)).toBeNull();
  });
});

describe("boundary corpus (tests/fixtures/boundary.ts)", () => {
  const nights = assembleNights(sleepInputs(boundarySpec()));

  test("nights 01-10, 01-12, 01-14 exist; naps are dropped", () => {
    expect(nights.map((n) => n.date)).toEqual(["2026-01-10", "2026-01-12", "2026-01-14"]);
  });

  test("01-10 night: 15:00 record and 08:59 record both count (20 min + 11 min)", () => {
    const n = nights.find((x) => x.date === "2026-01-10");
    expect(n?.stageSeconds.asleepCore).toBe(20 * 60 + 11 * 60);
  });

  test("cross-midnight pair (23:55 deep, 00:05 rem) lands in the 01-12 night, full durations", () => {
    const n = nights.find((x) => x.date === "2026-01-12");
    expect(n?.stageSeconds.asleepDeep).toBe(10 * 60);
    expect(n?.stageSeconds.asleepREM).toBe(45 * 60);
  });

  test("offset edge: 14:59 +0100 is a nap; 15:00 -0500 is the 01-14 night", () => {
    const n = nights.find((x) => x.date === "2026-01-14");
    expect(n?.stageSeconds.asleepCore).toBe(10 * 60);
  });
});

describe("general corpus (tests/fixtures/general.ts)", () => {
  const nights = assembleNights(sleepInputs(generalSpec()));
  const n05 = nights.find((x) => x.date === "2026-01-05");
  const n06 = nights.find((x) => x.date === "2026-01-06");

  test("night 01-05 is watch-only with all stages counted", () => {
    expect(n05?.dominantSource).toBe(WATCH);
    expect(n05?.stageSeconds.inBed).toBe(10 * 60);
    expect(n05?.stageSeconds.asleepDeep).toBe(70 * 60);
    expect(n05?.stageSeconds.awake).toBe(15 * 60); // 02:30-02:45 start < 09:00 -> same night
  });

  test("night 01-06 is app-only: watch's 00:30+ records belong to 01-05; 15:10 -0500 counts", () => {
    // Watch records starting 00:30-06:30 local belong to the 01-05 night (start < 09:00).
    // App: 23:10-23:40 core, 23:40-00:20 deep, 00:20-01:00 rem, 15:10 -0500 core (30 min).
    expect(n06?.dominantSource).toBe(SLEEP_APP);
    expect(n06?.stageSeconds.asleepCore).toBe(60 * 60);
    expect(n06?.stageSeconds.asleepDeep).toBe(40 * 60);
    expect(n06?.stageSeconds.asleepREM).toBe(40 * 60);
    expect(n06?.sourceSeconds[WATCH]).toBeUndefined();
  });
});

describe("B-N1–B-N9 persisted derivation", () => {
  test("B-N1 night abroad assigned in its own zone; sleep_h primary, HRV, usability, tz and export day", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(`INSERT INTO imports (created_at, zip_name, zip_size, status, export_date)
      VALUES ('2026-01-14T00:00:00Z', 'synthetic.zip', 1, 'done', '2026-01-18 20:00:00 +0900')`).run();
    const add = db.prepare(`INSERT INTO records
      (type, source_name, start_at, end_at, start_offset_min, end_offset_min, value, value_str,
       import_id, device_hw, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const insert = (
      type: string,
      source: string,
      start: string,
      end: string,
      hw: string,
      value: number | null = null,
      stage: string | null = null,
      zone: string | null = null,
    ) => {
      add.run(
        type,
        source,
        start,
        end,
        540,
        540,
        value,
        stage,
        hw,
        zone ? JSON.stringify({ HKTimeZone: zone }) : null,
      );
    };
    insert(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "Watch",
      "2026-01-11T06:00:00.000Z",
      "2026-01-11T17:00:00.000Z",
      "Watch7,5",
      null,
      SLEEP_VALUE.core,
      "America/Los_Angeles",
    );
    insert(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "Watch",
      "2026-01-11T17:30:00.000Z",
      "2026-01-11T17:45:00.000Z",
      "Watch7,5",
      null,
      SLEEP_VALUE.deep,
      "America/Los_Angeles",
    );
    insert(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "Watch",
      "2026-01-11T18:46:00.000Z",
      "2026-01-11T18:55:00.000Z",
      "Watch7,5",
      null,
      SLEEP_VALUE.rem,
      "America/Los_Angeles",
    );
    insert(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "Phone",
      "2026-01-11T06:00:00.000Z",
      "2026-01-11T19:30:00.000Z",
      "iPhone17,1",
      null,
      SLEEP_VALUE.deep,
      "America/Los_Angeles",
    );
    insert(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "Watch",
      "2026-01-11T14:00:00.000Z",
      "2026-01-11T14:20:00.000Z",
      "Watch7,5",
      null,
      SLEEP_VALUE.rem,
      "Asia/Tokyo",
    );
    insert(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "Watch",
      "2026-01-11T05:00:00.000Z",
      "2026-01-11T05:00:00.000Z",
      "Watch7,5",
      40,
    );
    insert(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "Watch",
      "2026-01-11T05:30:00.000Z",
      "2026-01-11T05:30:00.000Z",
      "Watch7,5",
      42,
    );
    insert(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "Watch",
      "2026-01-11T00:00:00.000Z",
      "2026-01-11T00:00:00.000Z",
      "Watch7,5",
      99,
    );
    insert(
      "HKQuantityTypeIdentifierHeartRate",
      "Watch",
      "2026-01-11T06:15:00.000Z",
      "2026-01-11T06:15:00.000Z",
      "Watch7,5",
      50,
    );
    insert(
      "HKQuantityTypeIdentifierHeartRate",
      "Watch",
      "2026-01-11T06:30:00.000Z",
      "2026-01-11T06:30:00.000Z",
      "Watch7,5",
      60,
    );
    for (let i = 0; i < 8; i++) {
      const sampleAt = new Date(
        Date.parse("2026-01-11T06:40:00.000Z") + i * 10 * 60_000,
      ).toISOString();
      insert("HKQuantityTypeIdentifierHeartRate", "Watch", sampleAt, sampleAt, "Watch7,5", 52 + i);
    }
    insert(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "Watch",
      "2026-01-11T06:00:00.000Z",
      "2026-01-11T06:00:00.000Z",
      "Watch7,5",
      44,
    );
    insert(
      "HKQuantityTypeIdentifierHeartRate",
      "Watch",
      "2026-01-11T17:15:00.000Z",
      "2026-01-11T17:15:00.000Z",
      "Watch7,5",
      120,
    );
    insert(
      "HKQuantityTypeIdentifierStepCount",
      "Watch",
      "2026-01-12T01:00:00.000Z",
      "2026-01-12T01:00:00.000Z",
      "Watch7,5",
      75,
    );
    insert(
      "HKQuantityTypeIdentifierStepCount",
      "Watch",
      "2026-01-18T01:00:00.000Z",
      "2026-01-18T01:00:00.000Z",
      "Watch7,5",
      100,
    );
    for (const day of ["2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16", "2026-01-17"]) {
      const sampleAt = `${day}T01:00:00.000Z`;
      insert("HKQuantityTypeIdentifierStepCount", "Watch", sampleAt, sampleAt, "Watch7,5", 80);
    }
    const laterNights = [
      ["2026-01-12", "2026-01-13T06:00:00.000Z"],
      ["2026-01-13", "2026-01-14T06:00:00.000Z"],
      ["2026-01-14", "2026-01-15T06:00:00.000Z"],
      ["2026-01-15", "2026-01-16T06:00:00.000Z"],
      ["2026-01-16", "2026-01-17T06:00:00.000Z"],
    ] as const;
    for (const [, start] of laterNights) {
      const startMs = Date.parse(start);
      insert(
        "HKCategoryTypeIdentifierSleepAnalysis",
        "Watch",
        start,
        new Date(startMs + 60 * 60_000).toISOString(),
        "Watch7,5",
        null,
        SLEEP_VALUE.core,
        "America/Los_Angeles",
      );
      for (let i = 0; i < 10; i++) {
        const sampleAt = new Date(startMs + (i + 1) * 3 * 60_000).toISOString();
        insert(
          "HKQuantityTypeIdentifierHeartRate",
          "Watch",
          sampleAt,
          sampleAt,
          "Watch7,5",
          50 + i,
        );
      }
      for (let i = 0; i < 3; i++) {
        const sampleAt = new Date(startMs + (i + 1) * 10 * 60_000).toISOString();
        insert(
          "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
          "Watch",
          sampleAt,
          sampleAt,
          "Watch7,5",
          40 + i,
        );
      }
    }

    const nights = rebuildNightPipeline(db);
    expect(
      nights.map(({ date, zone, tzChange, partialReason, asleepS }) => ({
        date,
        zone,
        tzChange,
        partialReason,
        asleepS,
      })),
    ).toEqual([
      {
        date: "2026-01-10",
        zone: "America/Los_Angeles",
        tzChange: 0,
        partialReason: null,
        asleepS: 3600 * 11 + 900,
      },
      { date: "2026-01-11", zone: "Asia/Tokyo", tzChange: 1, partialReason: null, asleepS: 1200 },
      ...["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"].map((date) => ({
        date,
        zone: "America/Los_Angeles",
        tzChange: date === "2026-01-12" ? 1 : 0,
        partialReason: null,
        asleepS: 3600,
      })),
    ]);
    expect(
      db
        .query(
          "SELECT metric, unit_day AS day, value, n, usable FROM metric_values WHERE metric IN ('sleep_hr','hrv_sdnn','deep_h') AND unit_day = '2026-01-10' ORDER BY metric, day",
        )
        .all(),
    ).toEqual([
      { metric: "deep_h", day: "2026-01-10", value: 0.25, n: 1, usable: 1 },
      { metric: "hrv_sdnn", day: "2026-01-10", value: 42, n: 3, usable: 1 },
      { metric: "sleep_hr", day: "2026-01-10", value: 55.5, n: 10, usable: 1 },
    ]);
    expect(
      db
        .query(
          "SELECT unit_day AS day, value, n FROM metric_values WHERE metric = 'steps' AND unit_day = '2026-01-12'",
        )
        .all(),
    ).toEqual([{ day: "2026-01-12", value: 75, n: 1 }]);
    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM metric_values WHERE metric = 'steps' AND unit_day = '2026-01-18'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query(`SELECT e.device_hw AS hardware, COUNT(*) AS count FROM metric_values mv
        JOIN epochs e ON e.id = mv.epoch_id WHERE mv.metric = 'sleep_h' GROUP BY e.device_hw`)
        .all(),
    ).toEqual([{ hardware: "Watch7,5", count: 7 }]);
    db.close();
  });
});

describe("assembleNights", () => {
  const UTC = (s: string) => `${s}`;

  test("durations use UTC instants, not local wall clock", () => {
    // Same instant pair expressed with a -0500 local start: 1h of real time.
    const nights = assembleNights([
      rec(
        "W",
        "asleepCore",
        "2026-01-06",
        900,
        UTC("2026-01-06T20:00:00.000Z"),
        UTC("2026-01-06T21:00:00.000Z"),
      ),
    ]);
    expect(nights[0]?.stageSeconds.asleepCore).toBe(3600);
  });

  test("cross-midnight record counts fully to its night", () => {
    const nights = assembleNights([
      rec(
        "W",
        "asleepDeep",
        "2026-01-05",
        23 * 60 + 30,
        UTC("2026-01-05T14:30:00.000Z"),
        UTC("2026-01-05T16:00:00.000Z"),
      ),
    ]);
    expect(nights.map((n) => n.date)).toEqual(["2026-01-05"]);
    expect(nights[0]?.stageSeconds.asleepDeep).toBe(90 * 60);
  });

  test("nap (12:00 start) is dropped entirely", () => {
    expect(
      assembleNights([
        rec(
          "W",
          "asleepCore",
          "2026-01-06",
          720,
          UTC("2026-01-06T03:00:00.000Z"),
          UTC("2026-01-06T03:30:00.000Z"),
        ),
      ]),
    ).toEqual([]);
  });

  test("tie on total seconds goes to the lexicographically smallest source", () => {
    const nights = assembleNights([
      rec(
        "Zeta",
        "asleepCore",
        "2026-01-06",
        1400,
        UTC("2026-01-06T05:00:00.000Z"),
        UTC("2026-01-06T06:00:00.000Z"),
      ),
      rec(
        "Alpha",
        "asleepREM",
        "2026-01-06",
        1400,
        UTC("2026-01-06T05:00:00.000Z"),
        UTC("2026-01-06T06:00:00.000Z"),
      ),
    ]);
    expect(nights[0]?.dominantSource).toBe("Alpha");
    expect(nights[0]?.stageSeconds.asleepREM).toBe(3600);
    expect(nights[0]?.stageSeconds.asleepCore).toBe(0);
  });

  test("tie is independent of input order", () => {
    const a = rec(
      "Beta",
      "asleepCore",
      "2026-01-06",
      1400,
      UTC("2026-01-06T05:00:00.000Z"),
      UTC("2026-01-06T06:00:00.000Z"),
    );
    const b = rec(
      "Alpha",
      "asleepCore",
      "2026-01-06",
      1400,
      UTC("2026-01-06T05:00:00.000Z"),
      UTC("2026-01-06T06:00:00.000Z"),
    );
    expect(assembleNights([a, b])[0]?.dominantSource).toBe("Alpha");
    expect(assembleNights([b, a])[0]?.dominantSource).toBe("Alpha");
  });

  test("two-source night: stages come only from the dominant source", () => {
    const nights = assembleNights([
      rec(
        "Watch",
        "asleepCore",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T16:00:00.000Z"),
      ), // 2h
      rec(
        "Watch",
        "awake",
        "2026-01-06",
        1380,
        UTC("2026-01-06T16:00:00.000Z"),
        UTC("2026-01-06T16:10:00.000Z"),
      ),
      rec(
        "App",
        "asleepDeep",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T14:50:00.000Z"),
      ), // 50m
      rec(
        "App",
        "asleepREM",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:50:00.000Z"),
        UTC("2026-01-06T15:30:00.000Z"),
      ),
    ]);
    const n = nights[0];
    expect(n?.dominantSource).toBe("Watch");
    expect(n?.stageSeconds.asleepCore).toBe(7200);
    expect(n?.stageSeconds.asleepDeep).toBe(0);
    expect(n?.stageSeconds.asleepREM).toBe(0);
    expect(n?.stageSeconds.awake).toBe(600);
    expect(n?.sourceSeconds).toEqual({ App: 5400, Watch: 7200 });
  });

  test("awake time does not count toward dominance", () => {
    const nights = assembleNights([
      rec(
        "A",
        "awake",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T16:00:00.000Z"),
      ),
      rec(
        "B",
        "asleepCore",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T14:10:00.000Z"),
      ),
    ]);
    expect(nights[0]?.dominantSource).toBe("B");
  });

  test("overlapping same-source records are summed as-is", () => {
    const nights = assembleNights([
      rec(
        "W",
        "asleepCore",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T15:00:00.000Z"),
      ),
      rec(
        "W",
        "asleepCore",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:30:00.000Z"),
        UTC("2026-01-06T15:30:00.000Z"),
      ),
    ]);
    expect(nights[0]?.stageSeconds.asleepCore).toBe(7200);
  });

  test("output is sorted by night date and all stages are present", () => {
    const nights = assembleNights([
      rec(
        "W",
        "asleepCore",
        "2026-01-08",
        1380,
        UTC("2026-01-08T14:00:00.000Z"),
        UTC("2026-01-08T14:10:00.000Z"),
      ),
      rec(
        "W",
        "asleepCore",
        "2026-01-06",
        1380,
        UTC("2026-01-06T14:00:00.000Z"),
        UTC("2026-01-06T14:10:00.000Z"),
      ),
    ]);
    expect(nights.map((n) => n.date)).toEqual(["2026-01-06", "2026-01-08"]);
    expect(Object.keys(nights[0]?.stageSeconds ?? {}).sort()).toEqual([
      "asleepCore",
      "asleepDeep",
      "asleepREM",
      "asleepUnspecified",
      "awake",
      "inBed",
    ]);
  });
});
