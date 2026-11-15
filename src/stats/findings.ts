import type { Database } from "bun:sqlite";
import { METRICS } from "../domain/metrics";
import { dispersionForZ } from "../domain/stats";
import type { BaselineResult, BaselineState, Confidence } from "./baselines";
import { type CheckDTO, deriveChecks } from "./checks";

export type FindingState = "computed" | "warming_up" | "insufficient" | "stale";
export type FindingSeverity = "within" | "notable" | "alert";
export type FindingDirection = "higher" | "lower" | "within";

export interface FindingRowDTO {
  metric: string;
  kind: "overnight" | "daytime" | "trendOnly";
  unit: string;
  trust: "high" | "moderate" | "low";
  trustNote: string;
  epochId: number | null;
  epochLabel: string | null;
  state: FindingState;
  direction: FindingDirection | null;
  severity: FindingSeverity;
  confidence: "high" | "medium" | "low" | null;
  z: number | null;
  recentMedian: number | null;
  baselineMedian: number | null;
  baselineLow: number | null;
  baselineHigh: number | null;
  kOutside: number | null;
  recentCount: number;
  baselineCount: number;
  warmup: { current: number; target: number; estimatedReadyDay: string | null } | null;
  onset: { day: string; openEnded: boolean } | null;
  checks: CheckDTO[];
  sparkline: Array<{ day: string; value: number | null; z: number | null; usable: boolean }>;
  caveats: string[];
}

function toFinding(db: Database, row: BaselineResult): FindingRowDTO | null {
  const spec = METRICS[row.metric];
  if (!spec || spec.kind === "trendOnly") return null;
  const stint =
    row.stintId === null
      ? null
      : (db.query("SELECT epoch_id AS epochId FROM stints WHERE id = ?").get(row.stintId) as {
          epochId: number;
        } | null);
  const epochId = stint?.epochId ?? null;
  const epoch =
    epochId === null
      ? null
      : (db.query("SELECT device_hw AS deviceHw FROM epochs WHERE id = ?").get(epochId) as {
          deviceHw: string;
        } | null);
  const asOf = row.asOfDay;
  const units =
    epochId === null
      ? []
      : (db
          .query(
            `SELECT unit_day AS day, value, usable FROM metric_values
     WHERE metric = ? AND epoch_id = ? AND unit_day >=
       (SELECT start_day FROM stints WHERE id = ?) AND unit_day <= ?
     ORDER BY unit_day DESC LIMIT 35`,
          )
          .all(row.metric, epochId, row.stintId, asOf) as Array<{
          day: string;
          value: number;
          usable: number;
        }>);
  const usable = units.filter((unit) => unit.usable === 1);
  const recent = usable.slice(0, 7);
  const baseline = usable.slice(7, 35);
  const severity: FindingSeverity = row.severity;
  const direction: FindingDirection | null =
    row.state !== "computed" || row.z === null
      ? null
      : severity === "within"
        ? "within"
        : row.z > 0
          ? "higher"
          : "lower";
  const sigma = row.dispersion ?? spec.floor;
  const sparkline = [...units].reverse().map((unit) => ({
    day: unit.day,
    value: unit.value,
    z:
      row.baseline === null
        ? null
        : Math.max(-10, Math.min(10, (unit.value - row.baseline) / sigma)),
    usable: unit.usable === 1,
  }));
  const warmup =
    row.state === "warming_up"
      ? {
          current: row.progress,
          target: 14,
          estimatedReadyDay: recent.length
            ? addCalendarDays(asOf, Math.max(0, 14 - row.progress))
            : null,
        }
      : null;
  const checks =
    epochId === null
      ? []
      : deriveChecks(
          db,
          row.metric,
          epochId,
          asOf,
          spec,
          recent.map((unit) => unit.day),
        );
  const dto: FindingRowDTO = {
    metric: row.metric,
    kind: spec.kind,
    unit: spec.unit,
    trust: spec.trust,
    trustNote: spec.trustNote,
    epochId,
    epochLabel: epoch?.deviceHw ?? null,
    state: row.state,
    direction,
    severity,
    confidence: row.confidence,
    z: row.z,
    recentMedian: row.recent,
    baselineMedian: row.baseline,
    baselineLow: row.baseline === null ? null : row.baseline - 1.5 * sigma,
    baselineHigh: row.baseline === null ? null : row.baseline + 1.5 * sigma,
    kOutside: row.kOutside,
    recentCount: recent.length,
    baselineCount: baseline.length,
    warmup,
    onset: row.onsetDay === null ? null : { day: row.onsetDay, openEnded: row.onsetOpen === true },
    checks,
    sparkline,
    caveats: checks.filter((check) => check.flagged).map((check) => check.key),
  };
  return dto;
}

function addCalendarDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

/** Rank and persist findings from current baseline rows. */
export function rebuildFindings(
  db: Database,
  baselines: readonly BaselineResult[],
): FindingRowDTO[] {
  const rows = baselines
    .map((row) => toFinding(db, row))
    .filter((row): row is FindingRowDTO => row !== null);
  for (const row of rows)
    db.run("UPDATE findings SET checks_json = ? WHERE metric = ?", [
      JSON.stringify(row.checks),
      row.metric,
    ]);
  return rankFindings(rows);
}

function rankFindings(rows: FindingRowDTO[], includeWithinDaytime = false): FindingRowDTO[] {
  const overnight = rows.filter((row) => row.kind === "overnight");
  const daytime = rows.filter(
    (row) => row.kind === "daytime" && (includeWithinDaytime || row.severity !== "within"),
  );
  const rank = (a: FindingRowDTO, b: FindingRowDTO) => {
    const order = Object.keys(METRICS);
    const stateRank = (row: FindingRowDTO) =>
      row.state === "computed" ? 0 : row.state === "warming_up" ? 1 : 2;
    return (
      stateRank(a) - stateRank(b) ||
      Math.abs(b.z ?? -1) - Math.abs(a.z ?? -1) ||
      (a.confidence === b.confidence
        ? 0
        : a.confidence === "high"
          ? -1
          : b.confidence === "high"
            ? 1
            : a.confidence === "medium"
              ? -1
              : 1) ||
      order.indexOf(a.metric) - order.indexOf(b.metric)
    );
  };
  return [...overnight.sort(rank), ...daytime.sort(rank)];
}

/**
 * Read and rank the persisted finding snapshot without writing to the database.
 * `includeWithinDaytime` keeps within-usual daytime rows, which the Changes list
 * omits (B-F7) but per-metric reads need.
 */
export function readFindings(db: Database, includeWithinDaytime = false): FindingRowDTO[] {
  const persisted = db
    .query(
      `SELECT metric, state, z, severity, confidence, onset_day AS onsetDay,
              onset_open AS onsetOpen, recent, baseline, k_outside AS kOutside,
              asof_day AS asOfDay, stint_id AS stintId
       FROM findings`,
    )
    .all() as Array<{
    metric: string;
    state: string;
    z: number | null;
    severity: FindingSeverity | null;
    confidence: Confidence | null;
    onsetDay: string | null;
    onsetOpen: number | null;
    recent: number | null;
    baseline: number | null;
    kOutside: number | null;
    asOfDay: string;
    stintId: number | null;
  }>;
  const results: BaselineResult[] = [];
  for (const row of persisted) {
    const spec = METRICS[row.metric];
    if (!spec || spec.kind === "trendOnly" || row.stintId === null) continue;
    const stint = db
      .query("SELECT epoch_id AS epochId, start_day AS startDay FROM stints WHERE id = ?")
      .get(row.stintId) as { epochId: number; startDay: string } | null;
    if (!stint) continue;
    const units = db
      .query(
        `SELECT value FROM metric_values WHERE metric = ? AND epoch_id = ?
         AND unit_day >= ? AND unit_day <= ? AND usable = 1 ORDER BY unit_day DESC LIMIT 35`,
      )
      .all(row.metric, stint.epochId, stint.startDay, row.asOfDay) as Array<{ value: number }>;
    const baselineValues = units.slice(7, 35).map((unit) => unit.value);
    results.push({
      metric: row.metric,
      state: row.state as BaselineState,
      z: row.z,
      dispersion: baselineValues.length ? dispersionForZ(baselineValues, spec.floor) : null,
      severity: row.severity ?? "within",
      confidence: row.confidence,
      onsetDay: row.onsetDay,
      onsetOpen: row.onsetOpen === null ? null : row.onsetOpen === 1,
      recent: row.recent,
      baseline: row.baseline,
      kOutside: row.kOutside,
      progress: units.length,
      asOfDay: row.asOfDay,
      stintId: row.stintId,
    });
  }
  return rankFindings(
    results.map((row) => toFinding(db, row)).filter((row): row is FindingRowDTO => row !== null),
    includeWithinDaytime,
  );
}
