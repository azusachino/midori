import type { Database } from "bun:sqlite";
import type {
  FindingSnapshotSummaryDTO,
  FindingsDiffClassification,
  FindingsDiffDTO,
  FindingsDiffItemDTO,
} from "../domain/api";
import { METRICS } from "../domain/metrics";
import type { FindingDirection, FindingSeverity, FindingState } from "./findings";

/**
 * Import-to-import findings diff (B-I13, B-F15). A compact snapshot of each import's
 * findings is written inside derive()'s transaction; the diff classifies movement between
 * two snapshots in a fixed, neutral priority order (B-F9).
 */

export interface SnapshotSeed {
  metric: string;
  state: string;
  z: number | null;
  severity: string | null;
  direction: string | null;
  confidence: string | null;
  asof_day: string;
}

type SnapshotRow = {
  import_id: number;
  metric: string;
  state: string;
  z: number | null;
  severity: string | null;
  direction: string | null;
  confidence: string | null;
  asof_day: string;
};

const isNotableOrAlert = (severity: string | null) =>
  severity === "notable" || severity === "alert";

const bothNotable = (prev: SnapshotRow, curr: SnapshotRow) =>
  prev.state === "computed" &&
  curr.state === "computed" &&
  isNotableOrAlert(prev.severity) &&
  isNotableOrAlert(curr.severity);

function directionFor(row: {
  state: string;
  z: number | null;
  severity: string | null;
}): FindingDirection | null {
  if (row.state !== "computed" || row.z === null) return null;
  if (row.severity === "within") return "within";
  return row.z > 0 ? "higher" : "lower";
}

/** B-I13: replace this import's snapshot with one row per non-trend finding. */
export function captureFindingSnapshot(db: Database, importId: number): void {
  db.run("DELETE FROM finding_snapshots WHERE import_id = ?", [importId]);
  const rows = db
    .query("SELECT metric, state, z, severity, confidence, asof_day FROM findings")
    .all() as Array<{
    metric: string;
    state: string;
    z: number | null;
    severity: string | null;
    confidence: string | null;
    asof_day: string;
  }>;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO finding_snapshots
       (import_id, metric, state, z, severity, direction, confidence, asof_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const spec = METRICS[row.metric];
    if (spec?.kind === "trendOnly") continue;
    insert.run(
      importId,
      row.metric,
      row.state,
      row.z,
      row.severity,
      directionFor(row),
      row.confidence,
      row.asof_day,
    );
  }
}

/** B-I13: insert an already-computed snapshot (migration/tests) without deleting. */
export function insertSnapshotRows(db: Database, importId: number, rows: SnapshotSeed[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO finding_snapshots
       (import_id, metric, state, z, severity, direction, confidence, asof_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows)
    insert.run(
      importId,
      row.metric,
      row.state,
      row.z,
      row.severity,
      row.direction,
      row.confidence,
      row.asof_day,
    );
}

function compare(prev: SnapshotRow, curr: SnapshotRow): FindingsDiffClassification | null {
  // Fixed priority order (B-F15). Guards keep non-computed states out of every
  // "computed" classification and keep moderating metrics out of shifted_further.
  if (bothNotable(prev, curr) && prev.direction !== curr.direction) return "direction_reversed";
  if (
    curr.state === "computed" &&
    isNotableOrAlert(curr.severity) &&
    !(prev.state === "computed" && isNotableOrAlert(prev.severity))
  )
    return "newly_notable";
  if (
    prev.state === "computed" &&
    isNotableOrAlert(prev.severity) &&
    curr.state === "computed" &&
    curr.severity === "within"
  )
    return "returned_to_usual";
  if (bothNotable(prev, curr) && prev.direction === curr.direction) {
    const escalated = prev.severity === "notable" && curr.severity === "alert";
    const movedFurther = Math.abs(curr.z ?? 0) - Math.abs(prev.z ?? 0) >= 0.5;
    if (escalated || movedFurther) return "shifted_further";
  }
  if (
    (prev.state === "warming_up" || prev.state === "insufficient") &&
    curr.state === "computed" &&
    curr.severity === "within"
  )
    return "baseline_ready";
  return null;
}

function summary(row: SnapshotRow): FindingSnapshotSummaryDTO {
  return {
    state: row.state as FindingState,
    severity: (row.severity ?? "within") as FindingSeverity,
    direction: row.direction as FindingDirection | null,
    z: row.z,
    confidence: row.confidence as "high" | "medium" | "low" | null,
  };
}

function snapshotRows(db: Database, importId: number): Map<string, SnapshotRow> {
  const rows = db
    .query("SELECT * FROM finding_snapshots WHERE import_id = ?")
    .all(importId) as SnapshotRow[];
  return new Map(rows.map((row) => [row.metric, row]));
}

function metricOrder(metrics: string[]): string[] {
  const order = Object.keys(METRICS);
  return [...metrics].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi) || a.localeCompare(b);
  });
}

/** Builds a diff between two captured snapshots; `null` when either side is unavailable. */
export function buildDiff(
  db: Database,
  fromImportId: number,
  toImportId: number,
): FindingsDiffDTO | null {
  const fromRows = snapshotRows(db, fromImportId);
  const toRows = snapshotRows(db, toImportId);
  if (fromRows.size === 0 || toRows.size === 0) return null;
  const metrics = metricOrder([...new Set([...fromRows.keys(), ...toRows.keys()])]);
  const items: FindingsDiffItemDTO[] = [];
  let unchangedCount = 0;
  for (const metric of metrics) {
    const spec = METRICS[metric];
    if (spec?.kind === "trendOnly") continue;
    const prev = fromRows.get(metric);
    const curr = toRows.get(metric);
    if (!prev || !curr) {
      unchangedCount += 1;
      continue;
    }
    const classification = compare(prev, curr);
    if (!classification) {
      unchangedCount += 1;
      continue;
    }
    items.push({
      metric,
      kind: spec?.kind === "daytime" ? "daytime" : "overnight",
      classification,
      previous: summary(prev),
      current: summary(curr),
    });
  }
  const fromAsOfDay = [...fromRows.values()][0]?.asof_day;
  const toAsOfDay = [...toRows.values()][0]?.asof_day;
  if (!fromAsOfDay || !toAsOfDay) return null;
  return {
    fromImportId,
    toImportId,
    fromAsOfDay,
    toAsOfDay,
    unchangedCount,
    items,
  };
}

type ImportSnapshotRef = { id: number; asofDay: string };

/**
 * B-F15 `GET /api/imports/:id/diff`: the target import's snapshot against the most recent
 * prior done snapshot with a strictly earlier as-of day. Returns null when an earlier done
 * import (duplicate B-I3 or older B-I4) already reached this as-of day.
 */
export function getImportDiff(db: Database, importId: number): FindingsDiffDTO | null {
  const target = db
    .query("SELECT id, status, as_of_day FROM imports WHERE id = ?")
    .get(importId) as { id: number; status: string; as_of_day: string | null } | null;
  if (!target || target.status !== "done") return null;
  const snapshot = db
    .query("SELECT asof_day FROM finding_snapshots WHERE import_id = ? LIMIT 1")
    .get(importId) as { asof_day: string } | null;
  const targetAsOf = snapshot?.asof_day ?? target.as_of_day;
  if (!targetAsOf) return null;

  const reachedEarlier = db
    .query(
      `SELECT 1 AS found FROM imports i
       LEFT JOIN finding_snapshots s ON s.import_id = i.id
       WHERE i.id < ? AND i.status = 'done'
         AND COALESCE(s.asof_day, i.as_of_day) >= ? LIMIT 1`,
    )
    .get(importId, targetAsOf);
  if (reachedEarlier) return null;

  const prev = priorSnapshot(db, importId, targetAsOf);
  if (!prev) return null;
  return buildDiff(db, prev.id, importId);
}

function priorSnapshot(
  db: Database,
  beforeImportId: number,
  beforeAsOf: string,
): ImportSnapshotRef | null {
  const row = db
    .query(
      `SELECT i.id, s.asof_day FROM imports i
       JOIN finding_snapshots s ON s.import_id = i.id
       WHERE i.status = 'done' AND i.id < ? AND s.asof_day < ?
       ORDER BY s.asof_day DESC, i.id DESC LIMIT 1`,
    )
    .get(beforeImportId, beforeAsOf) as { id: number; asof_day: string } | null;
  return row ? { id: row.id, asofDay: row.asof_day } : null;
}

/** B-F15 `ChangesDTO.sinceLastImport`: latest done snapshot vs the prior earlier snapshot. */
export function latestSinceLastImport(db: Database): FindingsDiffDTO | null {
  const current = db
    .query(
      `SELECT i.id, s.asof_day FROM imports i
       JOIN finding_snapshots s ON s.import_id = i.id
       WHERE i.status = 'done'
       ORDER BY i.id DESC, s.asof_day DESC LIMIT 1`,
    )
    .get() as { id: number; asof_day: string } | null;
  if (!current) return null;
  const prev = priorSnapshot(db, current.id, current.asof_day);
  if (!prev) return null;
  return buildDiff(db, prev.id, current.id);
}
