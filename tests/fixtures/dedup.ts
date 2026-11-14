/**
 * Dedup corpus: exercises the unique key (type, source_name, start, end, value) edges.
 *  - two byte-identical records (exact tie: must collapse to one row)
 *  - the same span with "60" and "60.0" (numeric equivalence: must collapse)
 *  - the same span with a different source (must NOT collapse)
 *  - records with no value attribute (NULL value; must be stored and must not collapse with
 *    a valued record)
 *  - category records (string values; compared raw, never numerically)
 * Synthetic only.
 */
import { buildFixture, type ExportSpec, type RecordSpec, SLEEP_VALUE, TYPE } from "./model";

export const DEDUP_SOURCE = "Synthetic Watch";
export const DEDUP_OTHER_SOURCE = "Synthetic Phone";
export const DEDUP_EXPORT_DATE = "2026-01-15 08:00:00 +0900";

export function dedupSpec(): ExportSpec {
  const hrSpan = { startDate: "2026-01-14 10:00:00 +0900", endDate: "2026-01-14 10:00:00 +0900" };
  const restSpan = { startDate: "2026-01-14 07:00:00 +0900", endDate: "2026-01-14 07:00:00 +0900" };
  const records: RecordSpec[] = [
    // Exact tie: two byte-identical records.
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      ...hrSpan,
      value: "60",
    },
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      ...hrSpan,
      value: "60",
    },
    // Numeric equivalence: same span, "60.0" instead of "60" (different raw string).
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      ...hrSpan,
      value: "60.0",
    },
    // Same numeric and span, different source: not a duplicate.
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_OTHER_SOURCE,
      unit: "count/min",
      ...hrSpan,
      value: "60",
    },
    // Resting HR with a no-value record (NULL) then a valued record on the same span.
    {
      type: TYPE.restingHeartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      ...restSpan,
    },
    {
      type: TYPE.restingHeartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      ...restSpan,
      value: "56",
    },
    // Two no-value records, identical: an exact tie with NULL value.
    {
      type: TYPE.restingHeartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      startDate: "2026-01-14 08:00:00 +0900",
      endDate: "2026-01-14 08:00:00 +0900",
    },
    {
      type: TYPE.restingHeartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      startDate: "2026-01-14 08:00:00 +0900",
      endDate: "2026-01-14 08:00:00 +0900",
    },
    // Category records: identical sleep-stage pair (exact tie), plus the same span with a
    // different stage (not a duplicate; value is categorical, never numeric-equivalent).
    {
      type: TYPE.sleep,
      sourceName: DEDUP_SOURCE,
      startDate: "2026-01-14 23:00:00 +0900",
      endDate: "2026-01-14 23:30:00 +0900",
      value: SLEEP_VALUE.core,
    },
    {
      type: TYPE.sleep,
      sourceName: DEDUP_SOURCE,
      startDate: "2026-01-14 23:00:00 +0900",
      endDate: "2026-01-14 23:30:00 +0900",
      value: SLEEP_VALUE.core,
    },
    {
      type: TYPE.sleep,
      sourceName: DEDUP_SOURCE,
      startDate: "2026-01-14 23:00:00 +0900",
      endDate: "2026-01-14 23:30:00 +0900",
      value: SLEEP_VALUE.deep,
    },
    // Category record with no value attribute at all (NULL), on its own span.
    {
      type: TYPE.sleep,
      sourceName: DEDUP_SOURCE,
      startDate: "2026-01-14 23:40:00 +0900",
      endDate: "2026-01-14 23:45:00 +0900",
    },
    // Same numeric, different span: not a duplicate.
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      startDate: "2026-01-14 10:01:00 +0900",
      endDate: "2026-01-14 10:01:00 +0900",
      value: "60",
    },
    // Equivalent numerics that differ textually beyond ".0": "60.00" vs "60" (same span).
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      startDate: "2026-01-14 10:02:00 +0900",
      endDate: "2026-01-14 10:02:00 +0900",
      value: "60.00",
    },
    {
      type: TYPE.heartRate,
      sourceName: DEDUP_SOURCE,
      unit: "count/min",
      startDate: "2026-01-14 10:02:00 +0900",
      endDate: "2026-01-14 10:02:00 +0900",
      value: "60",
    },
  ];
  return { exportDate: DEDUP_EXPORT_DATE, records, workouts: [] };
}

export const dedup = buildFixture("dedup", dedupSpec(), {});
