/**
 * General corpus (~50 records): multi-source, mixed UTC offsets, sleep stages with a nap,
 * night HR samples, HRV inside and outside the 21:00-09:00 window, one unrecognized type,
 * one explicitly malformed date, metadata entries, and a workout with a route file.
 * Synthetic only.
 */
import {
  buildFixture,
  type ExportSpec,
  type RecordSpec,
  SLEEP_VALUE,
  TYPE,
  type WorkoutSpec,
} from "./model";

export const WATCH = "Synthetic Watch";
export const PHONE = "Synthetic iPhone";
export const SLEEP_APP = "Synthetic Sleep App";

export const UNKNOWN_TYPE = "HKQuantityTypeIdentifierFixtureUnrecognized";
export const MALFORMED_START = "2026-02-30 10:00:00 +0900"; // no such calendar day
export const EXPORT_DATE = "2026-01-07 08:00:00 +0900";

function sample(
  type: string,
  sourceName: string,
  unit: string | undefined,
  start: string,
  value: string,
  metadata?: Readonly<Record<string, string>>,
): RecordSpec {
  const r: RecordSpec = { type, sourceName, startDate: start, endDate: start, value };
  if (unit !== undefined) r.unit = unit;
  r.device =
    sourceName === WATCH
      ? "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>"
      : "<<HKDevice: 0x2>, name:Synthetic iPhone, hardware:iPhone17,1, software:26.1, model:iPhone>";
  if (metadata !== undefined) r.metadata = metadata;
  return r;
}

function stage(
  value: string,
  sourceName: string,
  start: string,
  end: string,
  unit?: string,
): RecordSpec {
  const r: RecordSpec = {
    type: TYPE.sleep,
    sourceName,
    startDate: start,
    endDate: end,
    value,
    metadata: { HKTimeZone: "Asia/Tokyo" },
  };
  if (unit !== undefined) r.unit = unit;
  return r;
}

export function generalSpec(): ExportSpec {
  const records: RecordSpec[] = [
    // --- Night of 2026-01-05 from the watch: sleep stages across the night (start >= 15:00 -> 01-05).
    stage(SLEEP_VALUE.inBed, WATCH, "2026-01-05 22:50:00 +0900", "2026-01-05 23:00:00 +0900"),
    stage(SLEEP_VALUE.core, WATCH, "2026-01-05 23:00:00 +0900", "2026-01-05 23:20:00 +0900"),
    stage(SLEEP_VALUE.deep, WATCH, "2026-01-05 23:20:00 +0900", "2026-01-06 00:30:00 +0900"),
    stage(SLEEP_VALUE.core, WATCH, "2026-01-06 00:30:00 +0900", "2026-01-06 01:30:00 +0900"),
    stage(SLEEP_VALUE.rem, WATCH, "2026-01-06 01:30:00 +0900", "2026-01-06 02:30:00 +0900"),
    stage(SLEEP_VALUE.awake, WATCH, "2026-01-06 02:30:00 +0900", "2026-01-06 02:45:00 +0900"),
    stage(SLEEP_VALUE.core, WATCH, "2026-01-06 02:45:00 +0900", "2026-01-06 06:30:00 +0900"),
    // --- Night of 2026-01-06 from the sleep app (second source, dominant only if it were the sole source).
    stage(
      SLEEP_VALUE.core,
      SLEEP_APP,
      "2026-01-06 23:10:00 +0900",
      "2026-01-06 23:40:00 +0900",
      "min",
    ),
    stage(
      SLEEP_VALUE.deep,
      SLEEP_APP,
      "2026-01-06 23:40:00 +0900",
      "2026-01-07 00:20:00 +0900",
      "min",
    ),
    stage(
      SLEEP_VALUE.rem,
      SLEEP_APP,
      "2026-01-07 00:20:00 +0900",
      "2026-01-07 01:00:00 +0900",
      "min",
    ),
    // --- Daytime nap on 2026-01-06 (13:00-13:40 local): sleep-stage record, excluded by the night rule.
    stage(SLEEP_VALUE.core, WATCH, "2026-01-06 13:00:00 +0900", "2026-01-06 13:40:00 +0900"),
    // --- Night heart-rate samples, 01:00-06:00 on 2026-01-06 local.
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 01:00:00 +0900", "54"),
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 02:00:00 +0900", "52"),
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 03:00:00 +0900", "51"),
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 04:00:00 +0900", "53"),
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 05:00:00 +0900", "55"),
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-06 06:00:00 +0900", "58"),
    // --- Daytime heart-rate samples on 2026-01-06, every 60 minutes 09:00-17:00 local.
    ...[9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) =>
      sample(
        TYPE.heartRate,
        WATCH,
        "count/min",
        `2026-01-06 ${String(h).padStart(2, "0")}:00:00 +0900`,
        String(66 + (h % 5)),
      ),
    ),
    // --- Offset edge: -0500 sample. 2026-01-05 16:15 -0500 is 2026-01-06 06:15 +0900 (same instant).
    sample(TYPE.heartRate, WATCH, "count/min", "2026-01-05 16:15:00 -0500", "61"),
    // --- Offset edge: a steps sample recorded with +0100 (= 18:30 +0900 same day).
    sample(TYPE.steps, PHONE, "count", "2026-01-06 10:30:00 +0100", "412"),
    // --- HRV: two inside the 21:00-09:00 window, one outside (14:00).
    sample(TYPE.hrv, WATCH, "ms", "2026-01-05 21:30:00 +0900", "48.2", {
      HKMetadataKeyWasUserEntered: "0",
    }),
    sample(TYPE.hrv, WATCH, "ms", "2026-01-06 06:45:00 +0900", "52.7"),
    sample(TYPE.hrv, WATCH, "ms", "2026-01-06 14:00:00 +0900", "39.1"),
    // --- Resting heart rate and steps, multi-source.
    {
      type: TYPE.restingHeartRate,
      sourceName: WATCH,
      unit: "count/min",
      startDate: "2026-01-06 07:00:00 +0900",
      endDate: "2026-01-06 07:00:00 +0900",
      value: "57",
    },
    sample(TYPE.steps, PHONE, "count", "2026-01-06 08:15:00 +0900", "1240"),
    sample(TYPE.steps, PHONE, "count", "2026-01-06 12:45:00 +0900", "3302"),
    sample(TYPE.steps, WATCH, "count", "2026-01-06 18:20:00 +0900", "2877"),
    // --- Active energy (sum method) from two sources.
    sample(TYPE.activeEnergy, WATCH, "kcal", "2026-01-06 18:20:00 +0900", "143.5"),
    sample(TYPE.activeEnergy, PHONE, "kcal", "2026-01-06 12:45:00 +0900", "88"),
    // --- SpO2 fraction and respiratory rate during the night.
    sample(TYPE.spo2, WATCH, "%", "2026-01-06 03:20:00 +0900", "0.97"),
    sample(TYPE.spo2, WATCH, "%", "2026-01-06 04:20:00 +0900", "0.96"),
    sample(TYPE.respiratoryRate, WATCH, "count/min", "2026-01-06 03:25:00 +0900", "14.5"),
    sample(TYPE.respiratoryRate, WATCH, "count/min", "2026-01-06 04:25:00 +0900", "15"),
    // --- Wrist temperature during sleep (degC).
    sample(TYPE.wristTemp, WATCH, "degC", "2026-01-06 03:30:00 +0900", "35.42"),
    // --- A record whose type this build does not map.
    sample(UNKNOWN_TYPE, WATCH, "count", "2026-01-06 09:30:00 +0900", "1"),
    // --- Malformed-edge date: the day does not exist. Expected: stored as malformed, never silently fixed.
    {
      type: TYPE.steps,
      sourceName: PHONE,
      unit: "count",
      startDate: MALFORMED_START,
      endDate: MALFORMED_START,
      value: "7",
    },
    // --- Category record with no value attribute and a metadata key (absent-value edge).
    {
      type: TYPE.sleep,
      sourceName: WATCH,
      startDate: "2026-01-06 22:30:00 +0900",
      endDate: "2026-01-06 22:35:00 +0900",
      metadata: { HKMetadataKeySyncIdentifier: "synthetic-sync-001" },
    },
    // --- Offset edge: a record at -0500 for sleep, local 15:10 -> that date's night.
    stage(SLEEP_VALUE.core, SLEEP_APP, "2026-01-06 15:10:00 -0500", "2026-01-06 15:40:00 -0500"),
  ];

  const workouts: WorkoutSpec[] = [
    {
      activityType: "HKWorkoutActivityTypeRunning",
      sourceName: WATCH,
      durationMinutes: "32",
      startDate: "2026-01-06 07:00:00 +0900",
      endDate: "2026-01-06 07:32:00 +0900",
      metadata: { HKIndoorWorkout: "0" },
      routePath: "/workout-routes/route_2026-01-06_7.00am.gpx",
    },
    {
      activityType: "HKWorkoutActivityTypeYoga",
      sourceName: PHONE,
      durationMinutes: "20",
      startDate: "2026-01-06 19:00:00 +0900",
      endDate: "2026-01-06 19:20:00 +0900",
    },
  ];

  return { exportDate: EXPORT_DATE, records, workouts };
}

export const general = buildFixture("general", generalSpec(), {
  sources: 3,
  unknownType: UNKNOWN_TYPE,
  malformedStart: MALFORMED_START,
  nightOf0105Stages: 7,
  nightOf0106Stages: 5,
});
