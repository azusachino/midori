import type { Database } from "bun:sqlite";
import type {
  AsOfEntry,
  BriefingDTO,
  DeviationDTO,
  FindingDTO,
  ImportDTO,
  MetricDailyDTO,
  SourceDTO,
} from "../domain/api";
import { METRICS } from "../domain/metrics";
import { computeFindings } from "../stats/findings";

/**
 * Read queries shared by REST routes (T13) and the MCP server (T20): one
 * implementation of the contract — as-of + trust travel with every payload.
 * Kept dependency-free so both transports compose them identically.
 */

/** Cadence target for the staleness nudge, in days (single-user instance). */
export const IMPORT_CADENCE_DAYS = 30;

/** Default lookback window for /api/deviations and the deviations tool. */
export const DEFAULT_DEVIATION_DAYS = 14;

export function listImports(db: Database): ImportDTO[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, zip_name, zip_size, status, error, export_version,
              records_seen, records_inserted, records_deduped, duration_ms
       FROM imports ORDER BY id DESC`,
    )
    .all() as Array<{
    id: number;
    created_at: string;
    zip_name: string;
    zip_size: number;
    status: string;
    error: string | null;
    export_version: string | null;
    records_seen: number | null;
    records_inserted: number | null;
    records_deduped: number | null;
    duration_ms: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    zipName: r.zip_name,
    zipSize: r.zip_size,
    status: r.status as ImportDTO["status"],
    error: r.error,
    exportVersion: r.export_version,
    recordsSeen: r.records_seen,
    recordsInserted: r.records_inserted,
    recordsDeduped: r.records_deduped,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}

export function listSources(db: Database): SourceDTO[] {
  const rows = db
    .prepare(
      `SELECT name, first_seen_at, last_seen_at, record_count FROM sources ORDER BY record_count DESC`,
    )
    .all() as Array<{
    name: string;
    first_seen_at: string;
    last_seen_at: string;
    record_count: number;
  }>;
  return rows.map((r) => ({
    name: r.name,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    recordCount: r.record_count,
  }));
}

export function listFindings(db: Database, sinceDay?: string): FindingDTO[] {
  const rows = db
    .prepare(
      `SELECT kind, metric, source_name, anchor_day, window_days, baseline, recent,
              unit, z, severity, evidence, created_at
       FROM findings ${sinceDay ? "WHERE anchor_day >= ?" : ""}
       ORDER BY severity DESC, kind, metric, source_name`,
    )
    .all(...(sinceDay ? [sinceDay] : [])) as Array<{
    kind: string;
    metric: string;
    source_name: string;
    anchor_day: string;
    window_days: number;
    baseline: number | null;
    recent: number | null;
    unit: string | null;
    z: number | null;
    severity: string;
    evidence: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    kind: r.kind as FindingDTO["kind"],
    metric: r.metric,
    sourceName: r.source_name,
    anchorDay: r.anchor_day,
    windowDays: r.window_days,
    baseline: r.baseline,
    recent: r.recent,
    unit: r.unit,
    z: r.z,
    severity: r.severity as FindingDTO["severity"],
    evidence: JSON.parse(r.evidence) as FindingDTO["evidence"],
  }));
}

/** Freshest (sourceName, day) per metric for the briefing as-of map. */
export function asOfByMetric(db: Database): Record<string, AsOfEntry> {
  const rows = db
    .prepare(
      `SELECT metric, source_name, MAX(day) AS day
       FROM daily_metrics GROUP BY metric, source_name`,
    )
    .all() as Array<{ metric: string; source_name: string; day: string }>;
  const out: Record<string, AsOfEntry> = {};
  for (const r of rows) {
    const existing = out[r.metric];
    if (!existing || r.day > existing.day) {
      out[r.metric] = { sourceName: r.source_name, day: r.day };
    }
  }
  return out;
}

export function globalAnchorDay(db: Database): string | null {
  const row = db.prepare(`SELECT MAX(day) AS d FROM daily_metrics`).get() as { d: string | null };
  return row.d ?? null;
}

/** Deviations computed live, filtered to rows whose per-source as-of is recent enough. */
export function listDeviations(db: Database, days = DEFAULT_DEVIATION_DAYS): DeviationDTO[] {
  const anchor = globalAnchorDay(db);
  const { rows } = computeFindings(db);
  const cutoff =
    anchor === null
      ? null
      : new Date(Date.parse(`${anchor}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  return rows
    .filter((r) => (cutoff === null ? true : r.asOfDay >= cutoff))
    .map((r) => ({
      metric: r.metric,
      sourceName: r.sourceName,
      unit: r.unit,
      baseline: r.baseline,
      baselineLow: r.baselineLow,
      baselineHigh: r.baselineHigh,
      recent: r.recent,
      z: r.z,
      severity: r.severity,
      nBaseline: r.nBaseline,
      nRecent: r.nRecent,
      trust: r.trust,
      suppressed: r.suppressed,
    }))
    .sort((a, b) => {
      // computed first, ranked by |z|; suppressed last; deterministic tail order
      const za = Math.abs(a.z ?? 0);
      const zb = Math.abs(b.z ?? 0);
      if (a.z === null && b.z !== null) return 1;
      if (b.z === null && a.z !== null) return -1;
      if (a.z !== null && b.z !== null && za !== zb) return zb - za;
      return a.metric === b.metric
        ? a.sourceName.localeCompare(b.sourceName)
        : a.metric.localeCompare(b.metric);
    });
}

/** Per-source daily series for one metric; [] when the metric has no rows yet. */
export function metricDaily(db: Database, metric: string): MetricDailyDTO[] {
  const spec = METRICS[metric];
  if (!spec) return [];
  const rows = db
    .prepare(
      `SELECT source_name, day, value, sample_count FROM daily_metrics
       WHERE metric = ? ORDER BY source_name, day`,
    )
    .all(metric) as Array<{
    source_name: string;
    day: string;
    value: number;
    sample_count: number;
  }>;
  const bySource = new Map<string, MetricDailyDTO>();
  for (const r of rows) {
    let dto = bySource.get(r.source_name);
    if (!dto) {
      dto = {
        metric,
        sourceName: r.source_name,
        unit: spec.unit,
        method: spec.method,
        trust: spec.trust,
        trustNote: spec.trustNote,
        asOfDay: r.day,
        points: [],
      };
      bySource.set(r.source_name, dto);
    }
    dto.asOfDay = r.day; // last row per source is its freshest day
    dto.points.push({ day: r.day, value: r.value, sampleCount: r.sample_count });
  }
  return [...bySource.values()];
}

export function briefing(db: Database): BriefingDTO {
  const anchorDay = globalAnchorDay(db);
  const allImports = listImports(db);
  const lastImport = allImports[0] ?? null;
  let importCadenceHint: string | null = null;
  if (lastImport) {
    const ageDays = Math.floor((Date.now() - Date.parse(lastImport.createdAt)) / 86_400_000);
    if (ageDays > IMPORT_CADENCE_DAYS) {
      importCadenceHint = `last import ${ageDays} days ago`;
    }
  }
  return {
    anchorDay: anchorDay ?? "",
    asOf: asOfByMetric(db),
    findings: listFindings(db),
    sources: listSources(db),
    lastImport,
    importCadenceHint,
  };
}
