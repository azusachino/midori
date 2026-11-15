import type { Database } from "bun:sqlite";
import { median } from "../domain/stats";
import type { MetricUnit, Stint, UsablePredicate } from "./stints";

export interface SeamStep {
  metric: string;
  seamDay: string;
  kind: "offset" | "step";
  value: number;
  nOld: number;
  nNew: number;
}

const MIN_COMPARISONS = 7;
const WINDOW = 28;

/** Compare two adjacent primary stints without modifying either epoch's values. */
export function deriveSeamSteps(
  stints: readonly Stint[],
  units: readonly MetricUnit[],
  usable: UsablePredicate,
): SeamStep[] {
  const output: SeamStep[] = [];
  for (const [index, next] of stints.entries()) {
    if (index === 0) continue;
    const previous = stints[index - 1];
    if (!previous || previous.metric !== next.metric || previous.endDay === null) continue;
    const seamDay = next.startDay;
    const usableUnits = units.filter((unit) => unit.metric === next.metric && usable(unit));
    const oldByDay = new Map(
      usableUnits
        .filter((unit) => unit.epochId === previous.epochId)
        .map((unit) => [unit.unitDay, unit]),
    );
    const newByDay = new Map(
      usableUnits
        .filter((unit) => unit.epochId === next.epochId)
        .map((unit) => [unit.unitDay, unit]),
    );
    const shared = [...oldByDay.keys()].filter((day) => newByDay.has(day)).sort();
    if (shared.length >= MIN_COMPARISONS) {
      output.push({
        metric: next.metric,
        seamDay,
        kind: "offset",
        value: median(
          shared.map((day) => (newByDay.get(day)?.value ?? 0) - (oldByDay.get(day)?.value ?? 0)),
        ),
        nOld: shared.length,
        nNew: shared.length,
      });
      continue;
    }

    const oldValues = [...oldByDay.values()]
      .filter((unit) => unit.unitDay <= (previous.endDay ?? seamDay) && unit.unitDay < seamDay)
      .sort((a, b) => b.unitDay.localeCompare(a.unitDay))
      .slice(0, WINDOW);
    const newValues = [...newByDay.values()]
      .filter((unit) => unit.unitDay >= seamDay)
      .sort((a, b) => a.unitDay.localeCompare(b.unitDay))
      .slice(0, WINDOW);
    if (oldValues.length < MIN_COMPARISONS || newValues.length < MIN_COMPARISONS) continue;
    output.push({
      metric: next.metric,
      seamDay,
      kind: "step",
      value:
        median(newValues.map((unit) => unit.value)) - median(oldValues.map((unit) => unit.value)),
      nOld: oldValues.length,
      nNew: newValues.length,
    });
  }
  return output;
}

export function rebuildSeamSteps(db: Database, usable: UsablePredicate): SeamStep[] {
  const stints = db
    .prepare(
      "SELECT metric, epoch_id AS epochId, start_day AS startDay, end_day AS endDay FROM stints ORDER BY metric, start_day",
    )
    .all() as Stint[];
  const units = db
    .prepare(
      `SELECT metric, epoch_id AS epochId, e.kind AS epochKind, unit_day AS unitDay,
            unit_kind AS unitKind, value, n
     FROM metric_values JOIN epochs e ON e.id = epoch_id ORDER BY metric, unit_day, epoch_id`,
    )
    .all() as MetricUnit[];
  const rows = deriveSeamSteps(stints, units, usable);
  db.exec("DELETE FROM seam_steps");
  const insert = db.prepare(
    "INSERT INTO seam_steps (metric, seam_day, kind, value, n_old, n_new) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows)
    insert.run(row.metric, row.seamDay, row.kind, row.value, row.nOld, row.nNew);
  return rows;
}
