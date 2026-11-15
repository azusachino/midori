import type { Database } from "bun:sqlite";
import { utcToLocal } from "../domain/dates";
import { METRICS, type MetricSpec } from "../domain/metrics";
import { assembleNights, type SleepRecordInput, type SleepStage } from "./nights";

/**
 * Daily metrics (T10): one row per (metric, source, day) in daily_metrics.
 *
 * Pure derived cache — recomputed wholesale on every import (DELETE + INSERT),
 * same lifecycle as findings (docs/design.md: "findings are a cache").
 * Method per metric comes from the registry: median (robust to sample bursts)
 * or sum. Night-only metrics (HRV, wrist temp, respiratory rate) keep just the
 * 21:00–09:00 record-local samples. Sparse series stay sparse: days without
 * samples produce no row, never a zero.
 */

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

/** value_str -> stage. Legacy bare "Asleep" maps to asleepUnspecified (pre-iOS16 exports). */
function stageOf(valueStr: string): SleepStage | null {
  const bare = valueStr.startsWith("HKCategoryValueSleepAnalysis")
    ? valueStr.slice("HKCategoryValueSleepAnalysis".length)
    : valueStr;
  if (bare === "Asleep") return "asleepUnspecified";
  if (bare === "InBed") return "inBed";
  if (bare === "Awake") return "awake";
  for (const stage of ["asleepCore", "asleepDeep", "asleepREM", "asleepUnspecified"] as const) {
    if (bare.toLowerCase() === stage.toLowerCase()) return stage;
  }
  return null;
}

export interface DailyComputeSummary {
  metrics: number;
  rows: number;
  durationMs: number;
}

interface GroupRow {
  metric: string;
  source: string;
  day: string;
  method: "median" | "sum";
  unit: string | null;
  value: number;
  sampleCount: number;
}

function medianSorted(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : (lo + hi) / 2;
}

/** Stream quantity records grouped by (source, local day), emitting one row per group. */
function* quantityGroups(db: Database, spec: MetricSpec): Generator<GroupRow> {
  const placeholders = spec.types.map(() => "?").join(",");
  // Local day/minute are derived in SQL from the stored UTC instant + offset;
  // rows without an offset (should not exist) yield NULL day and are dropped.
  const modifier = "start_offset_min || ' minutes'";
  const timeExpr = `datetime(start_at, ${modifier})`;
  const dayExpr = `substr(${timeExpr}, 1, 10)`;
  const localTime = `strftime('%H:%M:%f', start_at, ${modifier})`;
  const nightFilter = spec.nightOnly
    ? `AND (${localTime} >= '21:00:00.000' OR ${localTime} < '09:00:00.000')`
    : "";
  const sql =
    `SELECT source_name AS src, ${dayExpr} AS day, value AS v ` +
    `FROM records WHERE type IN (${placeholders}) AND value IS NOT NULL ` +
    `AND ${dayExpr} IS NOT NULL ${nightFilter} ORDER BY src, day, v`;

  type Row = { src: string; day: string; v: number };
  let key: string | null = null;
  let values: number[] = [];
  const emit = (src: string, day: string): GroupRow => ({
    metric: spec.key,
    source: src,
    day,
    method: spec.method,
    unit: spec.unit,
    value: spec.method === "median" ? medianSorted(values) : values.reduce((a, b) => a + b, 0),
    sampleCount: values.length,
  });

  for (const row of db.prepare(sql).iterate(...spec.types) as Iterable<Row>) {
    const rowKey = `${row.src}\u0000${row.day}`;
    if (key !== null && rowKey !== key) {
      const [src, day] = key.split("\u0000");
      yield emit(src as string, day as string);
      values = [];
    }
    key = rowKey;
    values.push(row.v);
  }
  if (key !== null) {
    const [src, day] = key.split("\u0000");
    yield emit(src as string, day as string);
  }
}

/** Sleep-family metrics derived from night assembly (dominant source only). */
function* sleepGroups(db: Database, specs: MetricSpec[]): Generator<GroupRow> {
  if (specs.length === 0) return;
  const inputs: SleepRecordInput[] = [];
  type Row = {
    source_name: string;
    start_at: string;
    end_at: string;
    start_offset_min: number | null;
    value_str: string | null;
  };
  const sql =
    `SELECT source_name, start_at, end_at, start_offset_min, value_str ` +
    `FROM records WHERE type = ? AND value_str IS NOT NULL AND start_offset_min IS NOT NULL`;
  for (const row of db.prepare(sql).iterate(SLEEP_TYPE) as Iterable<Row>) {
    const stage = stageOf(row.value_str ?? "");
    if (!stage) continue;
    const local = utcToLocal(row.start_at, row.start_offset_min ?? 0);
    inputs.push({
      source: row.source_name,
      stage,
      startUtcIso: row.start_at,
      endUtcIso: row.end_at,
      startLocalDay: local.localDay,
      startLocalMinute: local.localMinute,
    });
  }
  for (const night of assembleNights(inputs)) {
    const count = night.sourceRecordCounts[night.dominantSource] ?? 0;
    for (const spec of specs) {
      const s = night.stageSeconds;
      const seconds =
        spec.key === "sleep_h"
          ? s.asleepCore + s.asleepDeep + s.asleepREM + s.asleepUnspecified
          : spec.key === "deep_h"
            ? s.asleepDeep
            : s.asleepREM;
      yield {
        metric: spec.key,
        source: night.dominantSource,
        day: night.date,
        method: "sum",
        unit: spec.unit,
        value: seconds / 3600,
        sampleCount: count,
      };
    }
  }
}

export function computeDailyMetrics(db: Database, importId: number): DailyComputeSummary {
  const t0 = performance.now();
  const nowIso = new Date().toISOString();

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM daily_metrics");
    const insert = db.prepare(
      `INSERT INTO daily_metrics
         (metric, source_name, day, method, unit, value, sample_count, computed_at, import_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let rows = 0;

    const allSpecs = Object.values(METRICS);
    const sleepSpecs = allSpecs.filter((s) => s.types.includes(SLEEP_TYPE));
    const quantitySpecs = allSpecs.filter((s) => !s.types.includes(SLEEP_TYPE));

    function* allRows(): Generator<GroupRow> {
      for (const spec of quantitySpecs) yield* quantityGroups(db, spec);
      yield* sleepGroups(db, sleepSpecs);
    }
    for (const row of allRows()) {
      insert.run(
        row.metric,
        row.source,
        row.day,
        row.method,
        row.unit,
        row.value,
        row.sampleCount,
        nowIso,
        importId,
      );
      rows += 1;
    }
    db.exec("COMMIT");
    const metrics = (
      db.prepare("SELECT DISTINCT metric FROM daily_metrics").all() as Array<{ metric: string }>
    ).length;
    return { metrics, rows, durationMs: Math.round(performance.now() - t0) };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
