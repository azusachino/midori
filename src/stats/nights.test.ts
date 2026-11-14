import { describe, expect, test } from "bun:test";
import { boundarySpec } from "../../tests/fixtures/boundary";
import { generalSpec, SLEEP_APP, WATCH } from "../../tests/fixtures/general";
import { SLEEP_VALUE } from "../../tests/fixtures/model";
import { parseHealthKitDate } from "../domain/dates";
import {
  assembleNights,
  nightKeyForSleepRecord,
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

describe("nightKeyForSleepRecord", () => {
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
