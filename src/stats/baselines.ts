import type { Database } from "bun:sqlite";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { median, robustZ, severityOf } from "../domain/stats";

export type BaselineState = "computed" | "warming_up" | "insufficient" | "stale";
export type Confidence = "low" | "medium" | "high";

export interface BaselineResult {
  metric: string;
  state: BaselineState;
  z: number | null;
  dispersion: number | null;
  severity: "within" | "notable" | "alert";
  confidence: Confidence | null;
  onsetDay: string | null;
  onsetOpen: boolean | null;
  recent: number | null;
  baseline: number | null;
  kOutside: number | null;
  progress: number;
  asOfDay: string;
  stintId: number | null;
}

export interface BaselineUnit {
  unitDay: string;
  value: number;
}

const RECENT_COUNT = 7;
const BASELINE_FIRST_RANK = 8;
const BASELINE_LAST_RANK = 35;
const RECENT_MINIMUM = 4;
const BASELINE_WARM_MINIMUM = 7;
const BASELINE_FULL_MINIMUM = 14;
const RECENT_MAX_AGE_DAYS = 14;

export function classifyConfidence(
  trust: string,
  baselineCount: number,
  recentCount: number,
): Confidence {
  if (trust === "low" || baselineCount < BASELINE_FULL_MINIMUM) return "low";
  if (baselineCount < 24 || recentCount < 6) return "medium";
  return "high";
}

export function deriveOnset(
  units: readonly BaselineUnit[],
  baselineMedian: number,
  sigma: number,
  stintStart: string,
  sideOverride?: -1 | 1,
): { day: string | null; open: boolean | null } {
  const newest = units[0];
  if (!newest) return { day: null, open: null };
  const low = baselineMedian - 1.5 * sigma;
  const high = baselineMedian + 1.5 * sigma;
  const side = sideOverride ?? (newest.value < low ? -1 : newest.value > high ? 1 : 0);
  if (!side) return { day: null, open: null };
  let lastOutside = 0;
  let insideSinceOutside = false;
  let open = false;
  for (let index = 1; index < units.length && index < BASELINE_LAST_RANK; index++) {
    const unit = units[index];
    if (!unit) continue;
    if (unit.unitDay < stintStart) break;
    const outside = side < 0 ? unit.value < low : unit.value > high;
    if (outside) {
      insideSinceOutside = false;
      lastOutside = index;
      if (index === BASELINE_LAST_RANK - 1 || unit.unitDay === stintStart) open = true;
    } else {
      if (insideSinceOutside) break;
      insideSinceOutside = true;
    }
  }
  return {
    day: units[lastOutside]?.unitDay ?? newest.unitDay,
    open,
  };
}

function deriveOne(
  metric: string,
  stint: { id: number; startDay: string; epochId: number },
  units: BaselineUnit[],
  asOfDay: string,
): BaselineResult {
  const recentUnits = units.slice(0, RECENT_COUNT);
  const baselineUnits = units.slice(BASELINE_FIRST_RANK - 1, BASELINE_LAST_RANK);
  const recent = recentUnits.length ? median(recentUnits.map((unit) => unit.value)) : null;
  const baseline = baselineUnits.length ? median(baselineUnits.map((unit) => unit.value)) : null;
  const recentFresh =
    units[0] !== undefined && addDays(units[0].unitDay, RECENT_MAX_AGE_DAYS) >= asOfDay;
  let state: BaselineState;
  let z: number | null = null;
  let dispersion: number | null = null;
  let confidence: Confidence | null = null;
  let onsetDay: string | null = null;
  let onsetOpen: boolean | null = null;
  let kOutside: number | null = null;
  if (recentUnits.length < RECENT_MINIMUM) state = "insufficient";
  else if (!recentFresh) state = "stale";
  else if (baselineUnits.length < BASELINE_WARM_MINIMUM) state = "warming_up";
  else {
    state = "computed";
    const spec = METRICS[metric];
    if (!spec || baseline === null || recent === null)
      throw new Error(`missing metric spec: ${metric}`);
    const score = robustZ(
      baselineUnits.map((unit) => unit.value),
      recentUnits.map((unit) => unit.value),
      spec.floor,
    );
    if (!score) throw new Error(`baseline gates passed without a score: ${metric}`);
    z = score.z;
    dispersion = score.dispersion;
    confidence = classifyConfidence(spec.trust, baselineUnits.length, recentUnits.length);
    kOutside = recentUnits.filter(
      (unit) => Math.abs(unit.value - baseline) > 1.5 * score.dispersion,
    ).length;
    if (severityOf(z) !== "within") {
      const foundOnset = deriveOnset(
        units,
        baseline,
        score.dispersion,
        stint.startDay,
        z < 0 ? -1 : 1,
      );
      onsetDay = foundOnset.day;
      onsetOpen = foundOnset.open;
    }
  }
  return {
    metric,
    state,
    z,
    dispersion,
    severity: severityOf(z),
    confidence,
    onsetDay,
    onsetOpen,
    recent,
    baseline,
    kOutside,
    progress: Math.min(BASELINE_FULL_MINIMUM, recentUnits.length + baselineUnits.length),
    asOfDay,
    stintId: stint.id,
  };
}

/** Compute and persist current-stint baseline rows from usable derived values. */
export function rebuildBaselines(db: Database): BaselineResult[] {
  const asOf = db
    .query("SELECT MAX(unit_day) AS day FROM metric_values WHERE metric = 'sleep_h' AND usable = 1")
    .get() as { day: string | null };
  if (!asOf.day) {
    db.exec("DELETE FROM findings");
    return [];
  }
  const stints = db
    .query(
      `SELECT s.id, s.metric, s.epoch_id AS epochId, s.start_day AS startDay
     FROM stints s WHERE s.end_day IS NULL ORDER BY s.metric`,
    )
    .all() as Array<{ id: number; metric: string; epochId: number; startDay: string }>;
  const rows: BaselineResult[] = [];
  const unitsQuery = db.prepare(
    `SELECT unit_day AS unitDay, value FROM metric_values
     WHERE metric = ? AND epoch_id = ? AND usable = 1 AND unit_day >= ? AND unit_day <= ?
     ORDER BY unit_day DESC LIMIT 35`,
  );
  for (const stint of stints) {
    if (METRICS[stint.metric]?.kind === "trendOnly") continue;
    const units = unitsQuery.all(
      stint.metric,
      stint.epochId,
      stint.startDay,
      asOf.day,
    ) as BaselineUnit[];
    rows.push(deriveOne(stint.metric, stint, units, asOf.day));
  }
  db.exec("DELETE FROM findings");
  const insert = db.prepare(
    `INSERT INTO findings (metric, state, z, severity, confidence, onset_day, onset_open,
      recent, baseline, k_outside, asof_day, stint_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows)
    insert.run(
      row.metric,
      row.state,
      row.z,
      row.severity,
      row.confidence,
      row.onsetDay,
      row.onsetOpen === null ? null : Number(row.onsetOpen),
      row.recent,
      row.baseline,
      row.kOutside,
      row.asOfDay,
      row.stintId,
    );
  return rows;
}
