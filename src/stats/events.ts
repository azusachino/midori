import type { Database } from "bun:sqlite";
import { METRICS } from "../domain/metrics";
import { detectBoundaries } from "../domain/stats";
import type { DeviceEventKind, SourceSpan } from "../domain/types";

/**
 * Device events (T12): the source-lifecycle ledger — first_seen / last_seen
 * (global, metric-less) and switch (per metric, at coverage seams).
 *
 * Events are historical facts with import-scoped recompute: each import
 * re-derives the current view and INSERT OR IGNOREs against the unique index
 * (kind, source, coalesce(metric,''), occurred_on), so the ledger never
 * duplicates. A last_seen day can be superseded by later data; the earlier
 * row stays as the observation made by that import.
 */

export interface DeviceEventRow {
  kind: DeviceEventKind;
  sourceName: string;
  metric: string | null;
  occurredOn: string;
  details: Record<string, unknown> | null;
}

interface SpanRow {
  source_name: string;
  firstDay: string;
  lastDay: string;
}

/** Metric-agnostic per-source spans from daily_metrics (local days). */
function globalSpans(db: Database): SpanRow[] {
  return db
    .prepare(
      `SELECT source_name, MIN(day) AS firstDay, MAX(day) AS lastDay
       FROM daily_metrics GROUP BY source_name`,
    )
    .all() as unknown as SpanRow[];
}

/** Per-metric per-source spans, e.g. for boundary detection. */
export function metricSpans(db: Database, metric: string): SourceSpan[] {
  return db
    .prepare(
      `SELECT source_name AS sourceName, MIN(day) AS firstDay, MAX(day) AS lastDay
         FROM daily_metrics WHERE metric = ? GROUP BY source_name`,
    )
    .all(metric) as unknown as SourceSpan[];
}

export function metricAnchor(db: Database, metric: string): string | null {
  const row = db
    .prepare(`SELECT MAX(day) AS anchor FROM daily_metrics WHERE metric = ?`)
    .get(metric) as { anchor: string | null } | null;
  return row?.anchor ?? null;
}

export function computeDeviceEvents(db: Database): DeviceEventRow[] {
  const events: DeviceEventRow[] = [];
  const spans = globalSpans(db);
  const globalLast = spans.reduce((max, s) => (s.lastDay > max ? s.lastDay : max), "");
  if (spans.length === 0) return events;

  for (const s of spans) {
    events.push({
      kind: "first_seen",
      sourceName: s.source_name,
      metric: null,
      occurredOn: s.firstDay,
      details: null,
    });
    // last_seen: this source stopped while any other source recorded later data
    if (s.lastDay < globalLast) {
      events.push({
        kind: "last_seen",
        sourceName: s.source_name,
        metric: null,
        occurredOn: s.lastDay,
        details: null,
      });
    }
  }

  // switch events at per-metric seams (abutting spans of different sources)
  for (const spec of Object.values(METRICS)) {
    const spansForMetric = metricSpans(db, spec.key);
    if (spansForMetric.length < 2) continue;
    const anchor = metricAnchor(db, spec.key);
    if (!anchor) continue;
    for (const b of detectBoundaries(spec.key, spansForMetric, anchor)) {
      if (b.kind === "switch") {
        events.push({
          kind: "switch",
          sourceName: b.sourceName,
          metric: spec.key,
          occurredOn: b.boundaryDay,
          details: { counterpart: b.counterpartSource },
        });
      }
    }
  }

  return events;
}

export function persistDeviceEvents(db: Database, importId: number): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO device_events (kind, source_name, metric, occurred_on, details, import_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  for (const e of computeDeviceEvents(db)) {
    const res = insert.run(
      e.kind,
      e.sourceName,
      e.metric,
      e.occurredOn,
      e.details === null ? null : JSON.stringify(e.details),
      importId,
    );
    added += res.changes;
  }
  return added;
}
