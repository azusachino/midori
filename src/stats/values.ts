import type { Database } from "bun:sqlite";
import { parseHealthKitDate } from "../domain/dates";
import { METRICS } from "../domain/metrics";

/** Reapply two-level completeness using only compact derived rows. */
export function rebuildMetricValues(db: Database): number {
  const exportRows = db
    .query(
      "SELECT export_date AS exportDate FROM imports WHERE status = 'done' AND export_date IS NOT NULL UNION ALL SELECT export_date AS exportDate FROM imports WHERE status NOT IN ('done', 'failed') AND export_date IS NOT NULL",
    )
    .all() as Array<{ exportDate: string }>;
  const exportDay =
    exportRows
      .map((row) => parseHealthKitDate(row.exportDate))
      .filter((parsed) => parsed.ok)
      .sort((a, b) => b.date.utcIso.localeCompare(a.date.utcIso))[0]?.date.localDay ?? null;
  const update = db.prepare(
    `UPDATE metric_values SET usable = CASE
       WHEN n >= ? AND (? IS NULL OR unit_kind <> 'day' OR unit_day <> ?) AND (unit_kind = 'day' OR EXISTS (
         SELECT 1 FROM nights WHERE nights.date = metric_values.unit_day AND partial_reason IS NULL
       )) THEN 1 ELSE 0 END
     WHERE metric = ?`,
  );
  let changed = 0;
  for (const spec of Object.values(METRICS))
    changed += Number(update.run(spec.minSamples, exportDay, exportDay, spec.key).changes);
  return changed;
}
