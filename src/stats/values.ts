import type { Database } from "bun:sqlite";
import { METRICS } from "../domain/metrics";

/** Reapply two-level completeness using only compact derived rows. */
export function rebuildMetricValues(db: Database): number {
  const update = db.prepare(
    `UPDATE metric_values SET usable = CASE
       WHEN n >= ? AND (unit_kind = 'day' OR EXISTS (
         SELECT 1 FROM nights WHERE nights.date = metric_values.unit_day AND partial_reason IS NULL
       )) THEN 1 ELSE 0 END
     WHERE metric = ?`,
  );
  let changed = 0;
  for (const spec of Object.values(METRICS))
    changed += Number(update.run(spec.minSamples, spec.key).changes);
  return changed;
}
