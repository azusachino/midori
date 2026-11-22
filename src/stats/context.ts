import type { Database } from "bun:sqlite";
import {
  AGENT_GUIDANCE,
  type AlignedNightDTO,
  type CheckDTO,
  type FindingRowDTO,
  type HealthContextDTO,
  type LongTermBaselineDTO,
  type NoteCategory,
} from "../domain/api";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { LEANING_ABS_Z, LEANING_MAX_ROWS } from "../domain/stats";
import { getChanges } from "../http/queries";
import { getProfileContext } from "./profile";

/**
 * B-A5: one structured dossier for an agent (REST `GET /api/context`, MCP
 * `health_context`). Findings come from the same ranked rows as `/api/changes`,
 * long-term medians are primary-stint `usable = 1` values only (ADR 0001), and
 * recent nights align sleep stages, usable overnight vitals, timezone, partial
 * data and overlapping notes per night.
 */

export const CONTEXT_DEFAULT_DAYS = 14;
export const CONTEXT_MIN_DAYS = 7;
export const CONTEXT_MAX_DAYS = 30;

/** B-A5: `days` must be an integer 7..30 (HTTP 400 / MCP `isError` otherwise). */
export function isValidContextDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CONTEXT_MIN_DAYS &&
    value <= CONTEXT_MAX_DAYS
  );
}

const CHECK_CAVEATS: Record<CheckDTO["key"], string> = {
  device_change: "A device change overlaps this finding.",
  os_update: "An operating system update overlaps this finding.",
  partial_nights: "Partial nights were skipped in the recent window.",
  tz_change: "A timezone change appears in the recent window.",
  missing_nights: "The recent observations are spread across a long calendar span.",
  low_trust: "This metric has low trust.",
  user_note: "A personal note overlaps the recent window.",
};

/** Human-readable caveat sentences for the checks flagged on one finding row. */
export function caveatsFor(row: FindingRowDTO): string[] {
  const caveats = row.checks
    .filter((check) => check.flagged)
    .map((check) => CHECK_CAVEATS[check.key] ?? "A data check is flagged.");
  if (row.state === "warming_up") caveats.push("The baseline is still warming up.");
  else if (row.state === "insufficient") caveats.push("There is not enough data for a finding.");
  else if (row.state === "stale") caveats.push("The latest usable data is stale.");
  return caveats;
}

const CHECK_NOUNS: Record<CheckDTO["key"], string> = {
  device_change: "a watch change",
  os_update: "an OS update",
  partial_nights: "partial nights",
  tz_change: "a timezone change",
  missing_nights: "missing nights",
  low_trust: "low-trust data",
  user_note: "a personal note",
};

const OVERNIGHT_METRICS = Object.values(METRICS)
  .filter((spec) => spec.kind === "overnight")
  .map((spec) => spec.key);

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) return null;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? null : (left + right) / 2;
}

function isNotableOrAlert(row: FindingRowDTO): boolean {
  return row.severity === "notable" || row.severity === "alert";
}

function isLeaning(row: FindingRowDTO): boolean {
  return (
    row.state === "computed" &&
    row.severity === "within" &&
    row.z !== null &&
    Math.abs(row.z) >= LEANING_ABS_Z
  );
}

/** B-F13: check keys flagged on at least half the computed rows, in first-seen order. */
function sharedFlaggedChecks(rows: readonly FindingRowDTO[]): CheckDTO["key"][] {
  const computed = rows.filter((row) => row.state === "computed");
  if (computed.length === 0) return [];
  const counts = new Map<CheckDTO["key"], number>();
  for (const row of computed) {
    for (const check of row.checks) {
      if (check.flagged) counts.set(check.key, (counts.get(check.key) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n * 2 >= computed.length).map(([key]) => key);
}

interface StintRef {
  epochId: number;
  startDay: string;
}

/** The open (primary) stint for a metric, or null when the metric has none. */
function currentStintFor(db: Database, metric: string): StintRef | null {
  return (
    (db
      .query(
        "SELECT epoch_id AS epochId, start_day AS startDay FROM stints WHERE metric = ? AND end_day IS NULL LIMIT 1",
      )
      .get(metric) as StintRef | null) ?? null
  );
}

const EMPTY_LONG_TERM: LongTermBaselineDTO = {
  median90d: null,
  median1y: null,
  n90d: 0,
  n1y: 0,
};

/**
 * B-A5: medians over the primary stint's `usable = 1` units inside
 * `[as-of - 89, as-of]` (90d) and `[as-of - 364, as-of]` (1y). Units before the
 * stint start or after the as-of day are never pooled (ADR 0001).
 */
function longTermFor(
  db: Database,
  metric: string,
  asOfDay: string | null,
  stint: StintRef | null,
): LongTermBaselineDTO {
  if (asOfDay === null || stint === null) return EMPTY_LONG_TERM;
  const from90 = addDays(asOfDay, -89);
  const from1y = addDays(asOfDay, -364);
  let start = from1y;
  if (stint.startDay > start) start = stint.startDay;
  const rows = db
    .query(
      `SELECT unit_day AS day, value FROM metric_values
       WHERE metric = ? AND epoch_id = ? AND unit_day >= ? AND unit_day <= ? AND usable = 1
       ORDER BY unit_day`,
    )
    .all(metric, stint.epochId, start, asOfDay) as Array<{ day: string; value: number }>;
  const values90 = rows.filter((row) => row.day >= from90).map((row) => row.value);
  const values1y = rows.map((row) => row.value);
  return {
    median90d: median(values90),
    median1y: median(values1y),
    n90d: values90.length,
    n1y: values1y.length,
  };
}

interface NightRow {
  date: string;
  zone: string;
  tz_change: number;
  partial_reason: string | null;
  asleep_s: number;
  core_s: number;
  deep_s: number;
  rem_s: number;
}

interface NightNoteRow {
  id: number;
  start_day: string;
  end_day: string;
  category: string;
  label: string;
}

/**
 * B-A5: up to `days` nights newest first, aligned across sleep stages, usable
 * primary-stint overnight metrics (missing or unusable -> null), timezone change,
 * partial-data reason and overlapping notes. Empty when there is no as-of day.
 */
function alignedNights(db: Database, asOfDay: string | null, days: number): AlignedNightDTO[] {
  if (asOfDay === null) return [];
  const from = addDays(asOfDay, -(days - 1));
  const nights = db
    .query(
      `SELECT date, zone, tz_change, partial_reason, asleep_s, core_s, deep_s, rem_s
       FROM nights WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    )
    .all(from, asOfDay) as NightRow[];
  const metricValues = new Map<string, number>();
  const overnight = new Set(OVERNIGHT_METRICS);
  const values = db
    .query(
      `SELECT v.unit_day AS day, v.metric, v.value FROM metric_values v
       JOIN stints s ON s.metric = v.metric AND s.epoch_id = v.epoch_id
         AND s.start_day <= v.unit_day AND (s.end_day IS NULL OR s.end_day >= v.unit_day)
       WHERE v.usable = 1 AND v.unit_day >= ? AND v.unit_day <= ?
       ORDER BY v.unit_day, v.metric`,
    )
    .all(from, asOfDay) as Array<{ day: string; metric: string; value: number }>;
  for (const row of values) {
    if (!overnight.has(row.metric)) continue;
    metricValues.set(`${row.metric}\u0000${row.day}`, row.value);
  }
  const noteRows = db
    .query(
      `SELECT id, start_day, end_day, category, label FROM notes
       WHERE start_day <= ? AND end_day >= ? ORDER BY start_day DESC, id DESC`,
    )
    .all(asOfDay, from) as NightNoteRow[];
  return nights.map((night) => {
    const metrics: Record<string, number | null> = {};
    for (const metric of OVERNIGHT_METRICS) {
      metrics[metric] = metricValues.get(`${metric}\u0000${night.date}`) ?? null;
    }
    return {
      date: night.date,
      zone: night.zone,
      tzChange: night.tz_change === 1,
      partialReason: night.partial_reason,
      sleep: {
        asleepH: night.asleep_s / 3600,
        deepH: night.deep_s / 3600,
        remH: night.rem_s / 3600,
        coreH: night.core_s / 3600,
      },
      metrics,
      notes: noteRows
        .filter((note) => note.start_day <= night.date && note.end_day >= night.date)
        .map((note) => ({
          id: note.id,
          category: note.category as NoteCategory,
          label: note.label,
        })),
    };
  });
}

/** B-A5: the read-only dossier behind `GET /api/context` and MCP `health_context`. */
export function getHealthContext(
  db: Database,
  days: number = CONTEXT_DEFAULT_DAYS,
): HealthContextDTO {
  const changes = getChanges(db);
  const overnight = changes.overnight;
  const daytimeNotable = changes.daytime.filter(isNotableOrAlert).length;
  const summary = {
    standsOut: overnight.filter(isNotableOrAlert).length + daytimeNotable,
    closeToEdge: overnight.filter(isLeaning).slice(0, LEANING_MAX_ROWS).length,
    within: overnight.filter((row) => row.state === "computed" && row.severity === "within").length,
    other: overnight.filter((row) => row.state !== "computed").length,
    sharedConfounders: sharedFlaggedChecks(overnight).map((key) => CHECK_NOUNS[key]),
  };
  const findings = [...changes.overnight, ...changes.daytime].map((row) => ({
    ...row,
    caveats: caveatsFor(row),
    longTerm: longTermFor(db, row.metric, changes.asOfDay, currentStintFor(db, row.metric)),
  }));
  return {
    asOfDay: changes.asOfDay,
    freshness: changes.freshness,
    primaryWatch: changes.primaryWatch,
    profile: getProfileContext(db),
    summary,
    findings,
    sinceLastImport: changes.sinceLastImport,
    recentNights: alignedNights(db, changes.asOfDay, days),
    recentNotes: changes.recentNotes,
    guidance: AGENT_GUIDANCE,
  };
}
