import type { Database } from "bun:sqlite";
import type { SuppressionReason } from "../domain/api";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { baselineOffsets, recentOffsets, robustZ, severityOf } from "../domain/stats";
import type { Severity, TrustLabel } from "../domain/types";

/**
 * Baselines + robust z + trust (T11). One analysis row per (metric, source)
 * that has any daily rows. Everything is per-source by construction — the
 * spike's wrist-temp lesson: cross-device offsets masquerade as physiology.
 *
 * Anchor semantics (grilled decision): the anchor for (metric, source) is that
 * source's LAST data day, surfaced as `asOfDay` on every row ("as of <date>").
 * Analyses are recomputed on read; nothing is persisted (findings, T12, are the
 * persisted cache). Cross-source and coverage-gap suppression arrive with T12;
 * here a row is either computed or suppressed=insufficient_data.
 */

export interface DeviationRow {
  metric: string;
  sourceName: string;
  unit: string | null;
  /** Baseline window median (anchor−90..anchor−29, sparse ok). */
  baseline: number | null;
  /** Recent window median (anchor−13..anchor, sparse ok). */
  recent: number | null;
  z: number | null;
  severity: Severity;
  nBaseline: number;
  nRecent: number;
  trust: TrustLabel;
  trustNote: string;
  suppressed: SuppressionReason | null;
  asOfDay: string;
}

export interface DeviationsResult {
  rows: DeviationRow[];
  durationMs: number;
}

interface DailyRow {
  day: string;
  value: number;
}

function medianOrNull(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const hi = sorted[mid];
  const lo = sorted[mid - 1];
  if (hi === undefined) return null;
  return sorted.length % 2 === 1 ? hi : lo === undefined ? hi : (lo + hi) / 2;
}

export function computeDeviations(db: Database): DeviationsResult {
  const t0 = performance.now();
  const rows: DeviationRow[] = [];

  const sourcesFor = db.prepare(
    `SELECT DISTINCT source_name FROM daily_metrics WHERE metric = ? ORDER BY source_name`,
  );
  const dailyFor = db.prepare(
    `SELECT day, value FROM daily_metrics WHERE metric = ? AND source_name = ? ORDER BY day`,
  );

  for (const spec of Object.values(METRICS)) {
    const sources = (sourcesFor.all(spec.key) as Array<{ source_name: string }>).map(
      (r) => r.source_name,
    );

    for (const source of sources) {
      const daily = dailyFor.all(spec.key, source) as unknown as DailyRow[];
      const anchor = daily[daily.length - 1]?.day;
      if (!anchor) continue;

      const byDay = new Map(daily.map((d) => [d.day, d.value]));
      const pick = (offsets: number[]): number[] => {
        const out: number[] = [];
        for (const o of offsets) {
          const v = byDay.get(addDays(anchor, o));
          if (v !== undefined) out.push(v);
        }
        return out;
      };
      const baseline = pick(baselineOffsets());
      const recent = pick(recentOffsets());
      const z = robustZ(baseline, recent);

      rows.push({
        metric: spec.key,
        sourceName: source,
        unit: spec.unit,
        baseline: medianOrNull(baseline),
        recent: medianOrNull(recent),
        z: z === null ? null : z.z,
        severity: z === null ? "info" : severityOf(z.z),
        nBaseline: baseline.length,
        nRecent: recent.length,
        trust: spec.trust,
        trustNote: spec.trustNote,
        suppressed: z === null ? "insufficient_data" : null,
        asOfDay: anchor,
      });
    }
  }

  return { rows, durationMs: Math.round(performance.now() - t0) };
}
