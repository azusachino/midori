import type {
  BandPointDTO,
  EpochRefDTO,
  MetricRange,
  MetricSeriesDTO,
  MetricUnitPointDTO,
  SeamStepDTO,
} from "../api/types";
import { copy } from "../copy";

export interface ChartTableColumn {
  key: string;
  label: string;
}

export interface ChartTableData {
  columns: readonly ChartTableColumn[];
  rows: ReadonlyArray<Record<string, string | number | boolean | null | undefined>>;
}

import {
  displayUnit,
  formatDayWithWeekday,
  formatMetricNumber,
  formatRangeSpan,
  formatShortDay,
  unitNounFor,
} from "./finding-format";

export interface BandPolygonPoint {
  xIndex: number;
  day: string;
  low: number;
  high: number;
  median: number;
}

export interface BandPolygonSegment {
  points: BandPolygonPoint[];
  minX: number;
  maxX: number;
  minLow: number;
  maxHigh: number;
}

export interface RecentUnitRow {
  day: string;
  dayLabel: string;
  valueText: string;
  zText: string;
  zTone: "alert" | "notable" | "within" | "none";
  deviceLabel: string;
  partialNote: string | null;
  tzChange: boolean;
  usable: boolean;
  isRecent: boolean;
}

const MS_PER_DAY = 86_400_000;
const MAX_CALENDAR_SPAN_DAYS = 3650;

function parseDayMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

function formatMsAsIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Builds a contiguous daily calendar axis across units, bands, and seams so missing days
 * stay visually proportional and `connectNulls: false` splits lines cleanly across holes.
 */
export function buildCalendarDays(series: MetricSeriesDTO): string[] {
  const days = new Set<string>();
  for (const u of series.units) days.add(u.day);
  for (const b of series.band) days.add(b.day);
  for (const s of series.seams) days.add(s.seamDay);

  if (days.size === 0) return [];
  const sorted = Array.from(days).sort();
  const firstMs = parseDayMs(sorted[0] ?? "");
  const lastMs = parseDayMs(sorted[sorted.length - 1] ?? "");
  if (firstMs === null || lastMs === null || lastMs < firstMs) {
    return sorted;
  }

  const totalDays = Math.floor((lastMs - firstMs) / MS_PER_DAY) + 1;
  if (totalDays > MAX_CALENDAR_SPAN_DAYS) {
    return sorted;
  }

  const out: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    out.push(formatMsAsIsoDay(firstMs + i * MS_PER_DAY));
  }
  return out;
}

/**
 * Splits `BandPointDTO[]` into contiguous segments so gaps between stints or warmup windows
 * become distinct custom polygon areas rather than stretching across missing baselines.
 * Supports arbitrary positive, zero-crossing, or all-negative coordinate ranges.
 */
export function buildBandPolygons(
  band: readonly BandPointDTO[],
  dayIndex: ReadonlyMap<string, number>,
): BandPolygonSegment[] {
  const ordered = [...band]
    .map((pt) => {
      const xIndex = dayIndex.get(pt.day);
      if (xIndex === undefined) return null;
      return { xIndex, day: pt.day, low: pt.low, high: pt.high, median: pt.median };
    })
    .filter((pt): pt is BandPolygonPoint => pt !== null)
    .sort((a, b) => a.xIndex - b.xIndex);

  const segments: BandPolygonSegment[] = [];
  let current: BandPolygonPoint[] = [];

  const flush = () => {
    if (current.length === 0) return;
    let minX = current[0]?.xIndex ?? 0;
    let maxX = minX;
    let minLow = current[0]?.low ?? 0;
    let maxHigh = current[0]?.high ?? 0;
    for (const p of current) {
      if (p.xIndex < minX) minX = p.xIndex;
      if (p.xIndex > maxX) maxX = p.xIndex;
      if (p.low < minLow) minLow = p.low;
      if (p.high > maxHigh) maxHigh = p.high;
    }
    segments.push({ points: current, minX, maxX, minLow, maxHigh });
    current = [];
  };

  for (const pt of ordered) {
    const prev = current[current.length - 1];
    if (prev && pt.xIndex - prev.xIndex > 1) {
      flush();
    }
    current.push(pt);
  }
  flush();

  return segments;
}

/** Only count/volume metrics pin y=0 (ui-design §5); temperature/HRV/HR float tightly. */
export function shouldIncludeZero(metric: string): boolean {
  return metric === "steps" || metric === "active_kj";
}

function formatSignedDelta(value: number, metric: string, unit: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const formatted = formatMetricNumber(Math.abs(value), metric, unit);
  const unitLabel = displayUnit(metric, unit);
  return unitLabel ? `${sign}${formatted} ${unitLabel}` : `${sign}${formatted}`;
}

/** Formats B-D6 offset vs B-D7 non-separable step seam label neutrally. */
export function formatSeamLabel(
  seam: SeamStepDTO,
  epochs: readonly EpochRefDTO[],
  metric: string,
  unit: string,
): string {
  const deltaText = formatSignedDelta(seam.value, metric, unit);
  if (seam.kind === "step") {
    return copy.chart.seamStep(deltaText);
  }
  const fromEpoch = epochs.find((e) => e.id === seam.fromEpochId);
  const toEpoch = epochs.find((e) => e.id === seam.toEpochId);
  const fromLabel = fromEpoch?.label ?? `#${seam.fromEpochId}`;
  const toLabel = toEpoch?.label ?? `#${seam.toEpochId}`;
  return copy.chart.seamOffset(fromLabel, toLabel, deltaText);
}

/** Computes [startDay, endDay] for the `isRecent` shaded highlight window. */
export function findRecentWindow(
  units: readonly MetricUnitPointDTO[],
): { startDay: string; endDay: string } | null {
  const recentDays = units
    .filter((u) => u.isRecent && u.value !== null)
    .map((u) => u.day)
    .sort();
  if (recentDays.length === 0) return null;
  const startDay = recentDays[0];
  const endDay = recentDays[recentDays.length - 1];
  return startDay && endDay ? { startDay, endDay } : null;
}

/** Resolves explicit URL zoom endpoints to indices within `days`, or null when unzoomed. */
export function resolveZoomWindow(
  days: readonly string[],
  zoomStart: string | undefined,
  zoomEnd: string | undefined,
): { startValue: number; endValue: number } | null {
  if (!zoomStart || !zoomEnd || days.length < 2) return null;
  const loDay = zoomStart <= zoomEnd ? zoomStart : zoomEnd;
  const hiDay = zoomStart <= zoomEnd ? zoomEnd : zoomStart;

  let startValue = days.findIndex((d) => d >= loDay);
  if (startValue < 0) startValue = 0;

  let endValue = days.length - 1;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d !== undefined && d <= hiDay) {
      endValue = i;
      break;
    }
  }

  if (endValue <= startValue) return null;
  if (startValue === 0 && endValue === days.length - 1) return null;
  return { startValue, endValue };
}

/** Maps an ECharts dataZoom gesture back to URL day bounds (or null if reset to full). */
export function zoomEventToDays(
  days: readonly string[],
  event: {
    start: number;
    end: number;
    startValue?: string | number | undefined;
    endValue?: string | number | undefined;
  },
): { zoomStart: string; zoomEnd: string } | null {
  if (days.length < 2) return null;
  const maxIdx = days.length - 1;

  const toIdx = (val: string | number | undefined, pct: number): number => {
    if (typeof val === "number" && Number.isFinite(val)) {
      return Math.max(0, Math.min(maxIdx, Math.round(val)));
    }
    if (typeof val === "string") {
      const found = days.indexOf(val);
      if (found >= 0) return found;
    }
    return Math.max(0, Math.min(maxIdx, Math.round((pct / 100) * maxIdx)));
  };

  const s = toIdx(event.startValue, event.start);
  const e = toIdx(event.endValue, event.end);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);

  if (lo <= 0 && hi >= maxIdx) return null;
  const zoomStart = days[lo];
  const zoomEnd = days[hi];
  if (!zoomStart || !zoomEnd) return null;
  return { zoomStart, zoomEnd };
}

export function formatPartialReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "export_cut") return copy.chart.partialExportCut;
  if (reason === "below_minimum") return copy.chart.partialBelowMin;
  return `${copy.chart.partialGeneric} (${reason})`;
}

export function formatZScore(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return "—";
  if (Math.abs(z) >= 10) return copy.pages.changes.clippedZ;
  const sign = z > 0 ? "+" : z < 0 ? "−" : "";
  return `${sign}${Math.abs(z).toFixed(1)}σ`;
}

function zToneFor(z: number | null): RecentUnitRow["zTone"] {
  if (z === null || !Number.isFinite(z)) return "none";
  const abs = Math.abs(z);
  if (abs >= 2.0) return "alert";
  if (abs >= 1.5) return "notable";
  return "within";
}

/** True only when the current stint has an established baseline (not warming/insufficient/trend-only). */
export function hasEstablishedBaseline(series: MetricSeriesDTO): boolean {
  if (series.kind === "trendOnly") return false;
  const f = series.finding;
  if (!f) return false;
  if (f.state === "warming_up" || f.state === "insufficient") return false;
  return f.baselineMedian !== null;
}

/**
 * Filters `series.band` to only the current stint's baseline ranks (ui-design §5).
 * Returns [] when there is no established baseline (warming_up, insufficient, trend-only),
 * and excludes any points from earlier stints.
 */
export function currentStintBandPoints(series: MetricSeriesDTO): BandPointDTO[] {
  if (!hasEstablishedBaseline(series) || series.band.length === 0) {
    return [];
  }
  const currentStint = [...series.stints].sort((a, b) =>
    a.endDay < b.endDay ? 1 : a.endDay > b.endDay ? -1 : 0,
  )[0];
  if (!currentStint) {
    return [...series.band];
  }
  return series.band.filter((b) => b.day >= currentStint.startDay && b.day <= currentStint.endDay);
}

/**
 * Builds the recent-units table below the chart (B-F1: recent window counts
 * `usableLimit` usable non-minor units only; skipped partial units between/before
 * them appear as muted rows with "—" in vs-usual and partial reason in Notes).
 */
export function buildRecentUnitRows(series: MetricSeriesDTO, usableLimit = 7): RecentUnitRow[] {
  const baselined = hasEstablishedBaseline(series);
  const epochById = new Map(series.epochs.map((e) => [e.id, e]));
  const sortedNonMinor = series.units
    .filter((u) => {
      const epoch = epochById.get(u.epochId);
      return !epoch?.minor;
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const selectedUnits: MetricUnitPointDTO[] = [];
  let usableCount = 0;
  for (const unit of sortedNonMinor) {
    const isUsableUnit = unit.usable && unit.value !== null;
    if (!isUsableUnit && unit.value === null && unit.partialReason === "missing") {
      continue;
    }
    selectedUnits.push(unit);
    if (isUsableUnit) {
      usableCount += 1;
      if (usableCount >= usableLimit) break;
    } else if (selectedUnits.length >= usableLimit + 7) {
      break;
    }
  }

  const unitLabel = displayUnit(series.metric, series.unit);

  return selectedUnits.map((u) => {
    const epoch = epochById.get(u.epochId);
    const valStr =
      u.value === null
        ? "—"
        : unitLabel
          ? `${formatMetricNumber(u.value, series.metric, series.unit)} ${unitLabel}`
          : formatMetricNumber(u.value, series.metric, series.unit);
    const effectiveZ = baselined && u.usable ? u.z : null;
    return {
      day: u.day,
      dayLabel: formatDayWithWeekday(u.day),
      valueText: valStr,
      zText: formatZScore(effectiveZ),
      zTone: zToneFor(effectiveZ),
      deviceLabel: epoch?.label ?? `#${u.epochId}`,
      partialNote: !u.usable
        ? (formatPartialReason(u.partialReason) ?? copy.chart.partialGeneric)
        : null,
      tzChange: u.tzChange,
      usable: u.usable,
      isRecent: u.isRecent,
    };
  });
}

/** Builds the one-line baseline summary shown beneath the recent-units table. */
export function buildBaselineSummary(series: MetricSeriesDTO): string {
  if (series.kind === "trendOnly") {
    return copy.pages.metricDetail.noBaselineTrendOnly;
  }
  const f = series.finding;
  if (
    !hasEstablishedBaseline(series) ||
    !f ||
    f.baselineMedian === null ||
    f.baselineLow === null ||
    f.baselineHigh === null ||
    f.baselineCount === 0
  ) {
    return copy.pages.metricDetail.noBaselineYet;
  }
  const noun = unitNounFor(f.kind);
  const unitLabel = displayUnit(series.metric, series.unit);
  const formatVal = (n: number) => formatMetricNumber(n, series.metric, series.unit);
  const medianText = unitLabel
    ? `${formatVal(f.baselineMedian)} ${unitLabel}`
    : formatVal(f.baselineMedian);
  const bandDays = currentStintBandPoints(series)
    .map((b) => b.day)
    .sort();
  const firstBandDay = bandDays[0];
  const lastBandDay = bandDays[bandDays.length - 1];
  const spanText =
    bandDays.length >= 2 && firstBandDay !== undefined && lastBandDay !== undefined
      ? formatRangeSpan(firstBandDay, lastBandDay)
      : null;

  return copy.pages.metricDetail.baselineSummary(
    f.baselineCount,
    noun,
    medianText,
    formatVal(f.baselineLow),
    formatVal(f.baselineHigh),
    spanText,
  );
}

/** Picks the next wider range when the current range contains zero units (§5). */
export function nextWiderRange(current: MetricRange): MetricRange | null {
  if (current === "90d") return "180d";
  if (current === "180d") return "1y";
  if (current === "1y") return "all";
  return null;
}

/** Builds an accessible one-line text summary of the rendered metric chart. */
export function buildMetricChartSummary(series: MetricSeriesDTO): string {
  const label = copy.metrics[series.metric] ?? series.metric;
  const unitLabel = displayUnit(series.metric, series.unit);
  const numericUnits = series.units.filter((u) => u.value !== null) as Array<
    MetricUnitPointDTO & { value: number }
  >;

  if (numericUnits.length === 0) {
    return `${label}: no readings in the ${copy.pages.metricDetail.ranges[series.range]} range.`;
  }

  const days = numericUnits.map((u) => u.day).sort();
  const values = numericUnits.map((u) => u.value);
  const minVal = formatMetricNumber(Math.min(...values), series.metric, series.unit);
  const maxVal = formatMetricNumber(Math.max(...values), series.metric, series.unit);
  const unitSuffix = unitLabel ? ` ${unitLabel}` : "";
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const span = firstDay && lastDay ? ` (${formatRangeSpan(firstDay, lastDay)})` : "";
  const seamText =
    series.seams.length > 0 && series.seams[0]
      ? `, ${series.seams.length} device seam (${formatShortDay(series.seams[0].seamDay)})`
      : "";
  const nonMinorCount = series.epochs.filter((e) => !e.minor).length;

  return `${label}: ${numericUnits.length} readings${span} ranging from ${minVal} to ${maxVal}${unitSuffix} across ${nonMinorCount} primary epochs${seamText}.`;
}

/** Builds an accessible hidden table mirror for screen readers (`EChart` `table` prop). */
export function buildMetricChartTable(series: MetricSeriesDTO): ChartTableData {
  const epochById = new Map(series.epochs.map((e) => [e.id, e]));
  const bandByDay = new Map(currentStintBandPoints(series).map((b) => [b.day, b]));
  const unitLabel = displayUnit(series.metric, series.unit);

  return {
    columns: [
      { key: "day", label: copy.chart.dayCol },
      { key: "value", label: copy.chart.valueCol },
      { key: "device", label: copy.chart.epochCol },
      { key: "usable", label: copy.chart.usableCol },
      { key: "bandLow", label: copy.chart.baselineLowCol },
      { key: "bandHigh", label: copy.chart.baselineHighCol },
    ],
    rows: series.units.map((u) => {
      const band = bandByDay.get(u.day);
      const valStr =
        u.value === null
          ? "—"
          : unitLabel
            ? `${formatMetricNumber(u.value, series.metric, series.unit)} ${unitLabel}`
            : formatMetricNumber(u.value, series.metric, series.unit);
      return {
        day: u.day,
        value: valStr,
        device: epochById.get(u.epochId)?.label ?? `#${u.epochId}`,
        usable: u.usable ? "yes" : (u.partialReason ?? "partial"),
        bandLow: band ? formatMetricNumber(band.low, series.metric, series.unit) : "—",
        bandHigh: band ? formatMetricNumber(band.high, series.metric, series.unit) : "—",
      };
    }),
  };
}
