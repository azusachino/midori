import type {
  EpochRefDTO,
  MetricSeriesDTO,
  MetricUnitPointDTO,
  SeamStepDTO,
  StintDTO,
} from "../api/types";
import { copy } from "../copy";
import { displayUnit, formatMetricNumber, formatShortDay } from "./finding-format";
import { deduplicateUnitsByDay } from "./metric-chart";

export interface ChartAccessibleTable {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
}

export interface LongViewCell {
  day: string;
  year: string;
  value: number;
  usable: boolean;
  partialReason: string | null;
  epochId: number;
  epochLabel: string;
  colorIndex: number | null;
  stintMedian: number;
  deviation: number;
  normalizedDev: number;
  seam: SeamStepDTO | null;
}

export interface LongViewYearGroup {
  year: string;
  cells: LongViewCell[];
  seams: SeamStepDTO[];
}

export interface LongViewModel {
  years: LongViewYearGroup[];
  activeEpochs: EpochRefDTO[];
  totalCells: number;
}

function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function robustScaleOf(values: number[], median: number): number {
  if (values.length < 2) {
    return Math.max(Math.abs(median) * 0.1, 1);
  }
  const absDevs = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const madSigma = medianOf(absDevs) * 1.4826;
  // Clamp symmetrically around stint median at +/-3 sigma (B-F9 / ui-design §5).
  if (madSigma > 1e-6) return madSigma * 3;
  const q95Idx = Math.min(absDevs.length - 1, Math.floor((absDevs.length - 1) * 0.95));
  const q95 = absDevs[q95Idx] ?? 0;
  return Math.max(q95, Math.abs(median) * 0.05, 0.25);
}

interface StintStats {
  median: number;
  scale: number;
}

function computeStintStats(
  nonMinorUnits: readonly MetricUnitPointDTO[],
  stints: readonly StintDTO[],
): Map<string, StintStats> {
  const statsByStintKey = new Map<string, StintStats>();
  for (const stint of stints) {
    const vals = nonMinorUnits
      .filter(
        (u) =>
          u.epochId === stint.epochId &&
          u.usable &&
          u.value !== null &&
          u.day >= stint.startDay &&
          u.day <= stint.endDay,
      )
      .map((u) => u.value as number)
      .sort((a, b) => a - b);

    const allValsForEpoch =
      vals.length > 0
        ? vals
        : nonMinorUnits
            .filter((u) => u.epochId === stint.epochId && u.value !== null)
            .map((u) => u.value as number)
            .sort((a, b) => a - b);

    const med = medianOf(allValsForEpoch);
    statsByStintKey.set(`${stint.epochId}:${stint.startDay}:${stint.endDay}`, {
      median: med,
      scale: robustScaleOf(allValsForEpoch, med),
    });
  }
  return statsByStintKey;
}

function statsForUnit(
  unit: MetricUnitPointDTO,
  nonMinorUnits: readonly MetricUnitPointDTO[],
  stints: readonly StintDTO[],
  stintStats: Map<string, StintStats>,
  epochFallbackCache: Map<number, StintStats>,
): StintStats {
  for (const s of stints) {
    if (s.epochId === unit.epochId && unit.day >= s.startDay && unit.day <= s.endDay) {
      const hit = stintStats.get(`${s.epochId}:${s.startDay}:${s.endDay}`);
      if (hit) return hit;
    }
  }
  const cached = epochFallbackCache.get(unit.epochId);
  if (cached) return cached;

  const usableEpochVals = nonMinorUnits
    .filter((u) => u.epochId === unit.epochId && u.usable && u.value !== null)
    .map((u) => u.value as number)
    .sort((a, b) => a - b);
  const allEpochVals =
    usableEpochVals.length > 0
      ? usableEpochVals
      : nonMinorUnits
          .filter((u) => u.epochId === unit.epochId && u.value !== null)
          .map((u) => u.value as number)
          .sort((a, b) => a - b);
  const med = medianOf(allEpochVals);
  const computed: StintStats = { median: med, scale: robustScaleOf(allEpochVals, med) };
  epochFallbackCache.set(unit.epochId, computed);
  return computed;
}

/**
 * Builds per-year calendar cells and seam markers using deviation from each stint's
 * usable median (ui-design §5 Long view). Excludes minor epochs and null gap days.
 */
export function buildLongViewModel(series: MetricSeriesDTO): LongViewModel {
  const epochById = new Map(series.epochs.map((e) => [e.id, e]));
  const seamByDay = new Map(series.seams.map((s) => [s.seamDay, s]));

  const rawNonMinor = series.units.filter((u) => {
    const ep = epochById.get(u.epochId);
    return !ep?.minor && u.value !== null;
  });

  const nonMinorUnits = deduplicateUnitsByDay(rawNonMinor, series).sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  );

  const stintStats = computeStintStats(nonMinorUnits, series.stints);
  const epochFallbackCache = new Map<number, StintStats>();
  const byYear = new Map<string, LongViewCell[]>();
  const seenEpochIds = new Set<number>();

  for (const u of nonMinorUnits) {
    if (u.value === null) continue;
    const ep = epochById.get(u.epochId);
    seenEpochIds.add(u.epochId);
    const year = u.day.slice(0, 4);
    const { median, scale } = statsForUnit(
      u,
      nonMinorUnits,
      series.stints,
      stintStats,
      epochFallbackCache,
    );
    const deviation = u.value - median;
    const normalizedDev = Math.max(-1, Math.min(1, deviation / scale));

    const cell: LongViewCell = {
      day: u.day,
      year,
      value: u.value,
      usable: u.usable,
      partialReason: u.partialReason,
      epochId: u.epochId,
      epochLabel: ep?.label ?? `#${u.epochId}`,
      colorIndex: ep?.colorIndex ?? null,
      stintMedian: median,
      deviation,
      normalizedDev,
      seam: seamByDay.get(u.day) ?? null,
    };
    const bucket = byYear.get(year) ?? [];
    bucket.push(cell);
    byYear.set(year, bucket);
  }

  const yearKeys = Array.from(byYear.keys()).sort();
  const years: LongViewYearGroup[] = yearKeys.map((year) => ({
    year,
    cells: byYear.get(year) ?? [],
    seams: series.seams.filter((s) => s.seamDay.slice(0, 4) === year),
  }));

  const activeEpochs = series.epochs.filter((e) => !e.minor && seenEpochIds.has(e.id));

  return {
    years,
    activeEpochs,
    totalCells: nonMinorUnits.length,
  };
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const COOL_EXTREME: readonly [number, number, number] = [56, 189, 248]; // #38bdf8 (--color-learning)
const NEUTRAL_MEDIAN: readonly [number, number, number] = [39, 39, 42]; // #27272a (--color-muted)
const WARM_EXTREME: readonly [number, number, number] = [251, 113, 133]; // #fb7185 (--color-alert)

/**
 * Single diverging color scale centered on stint median (`0` -> neutral surface-muted),
 * interpolating directly from cool sky (-1) through neutral muted (0) to warm rose (+1).
 */
export function divergingCellColor(normalizedDev: number): string {
  const clamped = Math.max(-1, Math.min(1, normalizedDev));
  if (clamped <= 0) {
    const t = clamped + 1; // -1 -> 0, 0 -> 1
    return rgb([
      lerp(COOL_EXTREME[0], NEUTRAL_MEDIAN[0], t),
      lerp(COOL_EXTREME[1], NEUTRAL_MEDIAN[1], t),
      lerp(COOL_EXTREME[2], NEUTRAL_MEDIAN[2], t),
    ]);
  }
  const t = clamped; // 0 -> 0, +1 -> 1
  return rgb([
    lerp(NEUTRAL_MEDIAN[0], WARM_EXTREME[0], t),
    lerp(NEUTRAL_MEDIAN[1], WARM_EXTREME[1], t),
    lerp(NEUTRAL_MEDIAN[2], WARM_EXTREME[2], t),
  ]);
}

export function formatSignedDeviation(deviation: number, metric: string, unit: string): string {
  const unitLabel = displayUnit(metric, unit);
  const sign = deviation > 0 ? "+" : deviation < 0 ? "−" : "";
  const formatted = formatMetricNumber(Math.abs(deviation), metric, unit);
  return unitLabel ? `${sign}${formatted} ${unitLabel}` : `${sign}${formatted}`;
}

export function buildLongViewSummary(metric: string, model: LongViewModel): string {
  const label = copy.metrics[metric] ?? metric;
  return copy.pages.metricDetail.longView.summary(label, model.totalCells, model.years.length);
}

export function buildLongViewTable(
  series: MetricSeriesDTO,
  model: LongViewModel,
): ChartAccessibleTable {
  const lv = copy.pages.metricDetail.longView;
  const unitLabel = displayUnit(series.metric, series.unit);
  const rows = model.years.flatMap((yr) =>
    yr.cells.map((cell) => ({
      year: yr.year,
      day: cell.day,
      value: unitLabel
        ? `${formatMetricNumber(cell.value, series.metric, series.unit)} ${unitLabel}`
        : formatMetricNumber(cell.value, series.metric, series.unit),
      device: cell.epochLabel,
      deviation: formatSignedDeviation(cell.deviation, series.metric, series.unit),
      partial: cell.usable ? "no" : (cell.partialReason ?? "yes"),
      seam: cell.seam ? `${cell.seam.kind} (${formatShortDay(cell.seam.seamDay)})` : "—",
    })),
  );

  return {
    columns: [
      { key: "year", label: lv.colYear },
      { key: "day", label: copy.chart.dayCol },
      { key: "value", label: copy.chart.valueCol },
      { key: "device", label: copy.chart.epochCol },
      { key: "deviation", label: lv.colDeviation },
      { key: "partial", label: lv.colPartial },
      { key: "seam", label: lv.colSeam },
    ],
    rows,
  };
}
