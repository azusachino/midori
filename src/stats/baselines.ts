import type { Database } from "bun:sqlite";
import type { DeviationDTO } from "../domain/api";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import {
  baselineOffsets,
  NOTABLE_ABS_Z,
  recentOffsets,
  robustZ,
  severityOf,
} from "../domain/stats";

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

export interface DeviationRow extends DeviationDTO {
  trustNote: string;
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
      const zr = robustZ(baseline, recent);
      const baseMed = medianOrNull(baseline);
      // Band = baseline \u00b1 1.5\u03c3_r, exactly the notable-severity edge; null when suppressed.
      const band =
        zr !== null && baseMed !== null && Number.isFinite(zr.dispersion)
          ? {
              low: baseMed - NOTABLE_ABS_Z * zr.dispersion,
              high: baseMed + NOTABLE_ABS_Z * zr.dispersion,
            }
          : null;

      rows.push({
        metric: spec.key,
        sourceName: source,
        unit: spec.unit,
        baseline: baseMed,
        baselineLow: band === null ? null : band.low,
        baselineHigh: band === null ? null : band.high,
        recent: medianOrNull(recent),
        z: zr === null ? null : zr.z,
        severity: zr === null ? "info" : severityOf(zr.z),
        nBaseline: baseline.length,
        nRecent: recent.length,
        trust: spec.trust,
        trustNote: spec.trustNote,
        suppressed: zr === null ? "insufficient_data" : null,
        asOfDay: anchor,
      });
    }
  }

  return { rows, durationMs: Math.round(performance.now() - t0) };
}
