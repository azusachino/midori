import type {
  BandPointDTO,
  EpochRefDTO,
  MetricRange,
  MetricSeriesDTO,
  MetricUnitPointDTO,
  OsUpdateEventDTO,
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
const RANGE_LOOKBACK_DAYS: Record<Exclude<MetricRange, "all">, number> = {
  "90d": 90,
  "180d": 180,
  "1y": 365,
};

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
 * Computes inclusive `[minDay, maxDay]` calendar bounds for bounded ranges (`90d`/`180d`/`1y`),
 * or `null` when `range === "all"`.
 */
export function getSeriesRangeBounds(
  series: Pick<MetricSeriesDTO, "range" | "asOfDay">,
): { minDay: string; maxDay: string } | null {
  if (series.range === "all" || series.asOfDay === null) return null;
  const asOfMs = parseDayMs(series.asOfDay);
  if (asOfMs === null) return null;
  return {
    minDay: formatMsAsIsoDay(asOfMs - RANGE_LOOKBACK_DAYS[series.range] * MS_PER_DAY),
    maxDay: series.asOfDay,
  };
}

function isDayInRangeBounds(
  day: string,
  bounds: { minDay: string; maxDay: string } | null,
): boolean {
  return !bounds || (day >= bounds.minDay && day <= bounds.maxDay);
}

/** Snaps an ISO day to the ISO week Monday matching the server's weekly bucket key. */
export function toWeekStartMonday(day: string): string {
  const ms = parseDayMs(day);
  if (ms === null) return day;
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return formatMsAsIsoDay(ms - dow * MS_PER_DAY);
}

/**
 * Deduplicates multiple epochs reporting on the same calendar day (e.g. overlapping watches or
 * watch + candidate phone), preferring the active covering stint epoch, then usable values.
 */
export function deduplicateUnitsByDay(
  units: readonly MetricUnitPointDTO[],
  series: Pick<MetricSeriesDTO, "epochs" | "stints">,
): MetricUnitPointDTO[] {
  const stintEpochForDay = (day: string): number | null => {
    const match = [...series.stints].reverse().find((s) => s.startDay <= day && day <= s.endDay);
    return match?.epochId ?? null;
  };
  const score = (u: MetricUnitPointDTO): number => {
    let s = 0;
    const primaryId = stintEpochForDay(u.day);
    if (primaryId !== null && u.epochId === primaryId) s += 4;
    if (u.usable && u.value !== null) s += 2;
    else if (u.value !== null) s += 1;
    return s;
  };

  const bestByDay = new Map<string, MetricUnitPointDTO>();
  for (const u of units) {
    const existing = bestByDay.get(u.day);
    if (!existing || score(u) > score(existing)) {
      bestByDay.set(u.day, u);
    }
  }
  return Array.from(bestByDay.values());
}

/**
 * Builds a contiguous daily (or weekly Monday for `range === "all"`) calendar axis across units,
 * bands, and seams so missing days/weeks stay proportional and `connectNulls: false` splits holes.
 */
export function buildCalendarDays(series: MetricSeriesDTO): string[] {
  const isWeekly = series.range === "all";
  const normalizeDay = (d: string) => (isWeekly ? toWeekStartMonday(d) : d);
  const bounds = getSeriesRangeBounds(series);

  const days = new Set<string>();
  for (const u of series.units) {
    const d = normalizeDay(u.day);
    if (isDayInRangeBounds(d, bounds)) days.add(d);
  }
  for (const b of series.band) {
    const d = normalizeDay(b.day);
    if (isDayInRangeBounds(d, bounds)) days.add(d);
  }
  for (const s of series.seams) {
    const d = normalizeDay(s.seamDay);
    if (isDayInRangeBounds(d, bounds)) days.add(d);
  }

  if (days.size === 0) return [];
  const sorted = Array.from(days).sort();
  const firstMs = parseDayMs(sorted[0] ?? "");
  const lastMs = parseDayMs(sorted[sorted.length - 1] ?? "");
  if (firstMs === null || lastMs === null || lastMs < firstMs) {
    return sorted;
  }

  const stepMs = isWeekly ? 7 * MS_PER_DAY : MS_PER_DAY;
  const maxSteps = isWeekly ? Math.floor(MAX_CALENDAR_SPAN_DAYS / 7) : MAX_CALENDAR_SPAN_DAYS;
  const totalSteps = Math.floor((lastMs - firstMs) / stepMs) + 1;
  if (totalSteps > maxSteps) {
    return sorted;
  }

  const out: string[] = [];
  for (let i = 0; i < totalSteps; i++) {
    out.push(formatMsAsIsoDay(firstMs + i * stepMs));
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
  const fromEpoch =
    seam.fromEpochId !== null ? epochs.find((e) => e.id === seam.fromEpochId) : undefined;
  const toEpoch = epochs.find((e) => e.id === seam.toEpochId);
  const fromLabel =
    fromEpoch?.label ?? (seam.fromEpochId !== null ? `#${seam.fromEpochId}` : "prior");
  const toLabel = toEpoch?.label ?? `#${seam.toEpochId}`;
  return copy.chart.seamOffset(fromLabel, toLabel, deltaText);
}

/**
 * Truncates long seam markLine labels so text stays within the plot grid while tooltip retains full text.
 */
export function clampSeamLabel(label: string, maxLen = 44): string {
  if (label.length <= maxLen) return label;
  return `${label.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export interface SeamLabelLayout {
  seam: SeamStepDTO;
  seamDay: string;
  seamIdx: number;
  fullLabel: string;
  displayLabel: string;
  align: "left" | "center" | "right";
  showLabel: boolean;
}

const SEAM_MIN_SPACING_PX = 120;
const SEAM_LABEL_PADDING_PX = 16;

export function estimateTextWidthPx(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) > 0x7f ? 11.5 : 6.4;
  }
  return width;
}

/** Estimates how many wrapped rows the epoch legend occupies at a given chart width. */
export function estimateLegendRows(labels: readonly string[], chartWidth: number): number {
  if (labels.length === 0) return 0;
  const available = Math.max(120, chartWidth - 8);
  const itemOverhead = 8 + 6 + 14; // icon + text gap + itemGap
  let rows = 1;
  let currentX = 0;
  for (const label of labels) {
    const itemWidth = Math.ceil(estimateTextWidthPx(label)) + itemOverhead;
    if (currentX > 0 && currentX + itemWidth > available) {
      rows += 1;
      currentX = itemWidth;
    } else {
      currentX += itemWidth;
    }
  }
  return rows;
}

function clampSeamLabelToWidth(label: string, maxChars: number, maxWidthPx: number): string {
  let out = clampSeamLabel(label, maxChars);
  while (out.length > 2 && estimateTextWidthPx(out) + SEAM_LABEL_PADDING_PX > maxWidthPx) {
    out = `${out.slice(0, out.length - 2).trimEnd()}…`;
  }
  return out;
}

const MIN_SEAM_LABEL_WIDTH_PX = 72;

/**
 * Places seam markLine labels inside the grid and suppresses overlapping or clipped labels
 * (keeping a top marker on the line and full text in tooltip).
 */
export function resolveSeamLabelLayouts(
  seams: readonly SeamStepDTO[],
  epochs: readonly EpochRefDTO[],
  days: readonly string[],
  metric: string,
  unit: string,
  options?: {
    isWeekly?: boolean | undefined;
    gridWidth?: number | undefined;
    viewStartIdx?: number | undefined;
    viewEndIdx?: number | undefined;
    minSpacingPx?: number | undefined;
  },
): (SeamLabelLayout & { spanEnd: number })[] {
  if (seams.length === 0 || days.length === 0) return [];

  const isWeekly = options?.isWeekly ?? false;
  const gridWidth = Math.max(160, options?.gridWidth ?? 800);
  const viewStart = Math.max(0, options?.viewStartIdx ?? 0);
  const viewEnd = Math.min(days.length - 1, options?.viewEndIdx ?? days.length - 1);
  const span = Math.max(1, viewEnd - viewStart);
  const minSpacingPx = options?.minSpacingPx ?? SEAM_MIN_SPACING_PX;

  const dayIndex = new Map<string, number>();
  days.forEach((d, idx) => {
    dayIndex.set(d, idx);
  });

  const candidates = seams.flatMap((seam) => {
    const seamDay = isWeekly ? toWeekStartMonday(seam.seamDay) : seam.seamDay;
    const seamIdx = dayIndex.get(seamDay);
    if (seamIdx === undefined) return [];
    const ratio = (seamIdx - viewStart) / span;
    const xPx = ratio * gridWidth;
    const fullLabel = formatSeamLabel(seam, epochs, metric, unit);
    const fullBoxPx = estimateTextWidthPx(fullLabel) + SEAM_LABEL_PADDING_PX;

    let align: "left" | "center" | "right";
    let availWidthPx: number;
    if (ratio < 0.35) {
      align = "left";
      availWidthPx = gridWidth - xPx - 6;
    } else if (ratio > 0.65) {
      align = "right";
      availWidthPx = xPx - 6;
    } else if (fullBoxPx / 2 <= Math.min(xPx, gridWidth - xPx) - 6) {
      align = "center";
      availWidthPx = 2 * Math.min(xPx, gridWidth - xPx) - 12;
    } else if (gridWidth - xPx >= xPx) {
      align = "left";
      availWidthPx = gridWidth - xPx - 6;
    } else {
      align = "right";
      availWidthPx = xPx - 6;
    }

    const cappedAvailPx = Math.min(Math.max(0, availWidthPx), Math.max(110, gridWidth - 20));
    const displayLabel = clampSeamLabelToWidth(fullLabel, 44, cappedAvailPx);
    const boxWidthPx = estimateTextWidthPx(displayLabel) + SEAM_LABEL_PADDING_PX;
    const rawSpanStart =
      align === "left" ? xPx : align === "right" ? xPx - boxWidthPx : xPx - boxWidthPx / 2;
    const spanStart = Math.max(0, Math.min(gridWidth - boxWidthPx, rawSpanStart));
    const spanEnd = spanStart + boxWidthPx;
    return [
      {
        seam,
        seamDay,
        seamIdx,
        fullLabel,
        displayLabel,
        align,
        xPx,
        spanStart,
        spanEnd,
        fitsWidth: cappedAvailPx >= MIN_SEAM_LABEL_WIDTH_PX && boxWidthPx <= cappedAvailPx + 2,
      },
    ];
  });

  // Prefer keeping labels on newer seams (rightmost first); older colliding seams become markers + tooltip.
  const orderedNewestFirst = [...candidates].sort((a, b) => b.seamIdx - a.seamIdx);
  const placed: Array<{ xPx: number; spanStart: number; spanEnd: number }> = [];
  const showBySeam = new Map<SeamStepDTO, boolean>();

  for (const cand of orderedNewestFirst) {
    const inPlot = cand.seamIdx >= viewStart && cand.seamIdx <= viewEnd;
    const collides = placed.some(
      (p) =>
        Math.abs(cand.xPx - p.xPx) < minSpacingPx ||
        (cand.spanStart - 8 <= p.spanEnd && cand.spanEnd + 8 >= p.spanStart),
    );
    const showLabel = inPlot && cand.fitsWidth && !collides;
    if (showLabel) {
      placed.push({ xPx: cand.xPx, spanStart: cand.spanStart, spanEnd: cand.spanEnd });
    }
    showBySeam.set(cand.seam, showLabel);
  }

  return candidates.map(({ seam, seamDay, seamIdx, fullLabel, displayLabel, align, spanEnd }) => ({
    seam,
    seamDay,
    seamIdx,
    fullLabel,
    displayLabel,
    align,
    spanEnd,
    showLabel: showBySeam.get(seam) ?? false,
  }));
}

/**
 * Filters OS update events to those inside the plotted axis window belonging to the active
 * primary epoch in view (covering baseline stint, or latest active non-minor epoch when trend-only).
 */
export function selectPrimaryOsUpdatesInView(
  series: Pick<MetricSeriesDTO, "epochs" | "stints" | "osUpdates" | "units" | "range">,
  days: readonly string[],
): OsUpdateEventDTO[] {
  if (days.length === 0 || series.osUpdates.length === 0) return [];
  const isWeekly = series.range === "all";
  const normalizeDay = (d: string) => (isWeekly ? toWeekStartMonday(d) : d);
  const daySet = new Set(days);
  const nonMinorEpochs = series.epochs.filter((e) => !e.minor);
  const nonMinorIds = new Set(nonMinorEpochs.map((e) => e.id));

  let fallbackPrimaryId: number | null = null;
  if (series.stints.length === 0) {
    const latestDayByEpoch = new Map<number, string>();
    for (const u of series.units) {
      if (!nonMinorIds.has(u.epochId) || !daySet.has(normalizeDay(u.day))) continue;
      const prev = latestDayByEpoch.get(u.epochId);
      if (!prev || u.day > prev) latestDayByEpoch.set(u.epochId, u.day);
    }
    let bestDay = "";
    for (const [id, maxDay] of latestDayByEpoch) {
      if (maxDay > bestDay) {
        bestDay = maxDay;
        fallbackPrimaryId = id;
      }
    }
    if (fallbackPrimaryId === null) {
      fallbackPrimaryId = nonMinorEpochs[nonMinorEpochs.length - 1]?.id ?? null;
    }
  }

  return series.osUpdates.filter((u) => {
    if (!nonMinorIds.has(u.epochId)) return false;
    if (!daySet.has(normalizeDay(u.day))) return false;
    if (series.stints.length > 0) {
      const covering = [...series.stints]
        .reverse()
        .find((s) => s.startDay <= u.day && u.day <= s.endDay);
      return covering ? covering.epochId === u.epochId : false;
    }
    return fallbackPrimaryId !== null && u.epochId === fallbackPrimaryId;
  });
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
  const truncatedTenths = Math.trunc(Math.abs(z) * 10) / 10;
  const sign = truncatedTenths === 0 ? "" : z > 0 ? "+" : "−";
  return `${sign}${truncatedTenths.toFixed(1)}σ`;
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
  const bounds = getSeriesRangeBounds(series);
  const currentStint = [...series.stints].sort((a, b) =>
    a.endDay < b.endDay ? 1 : a.endDay > b.endDay ? -1 : 0,
  )[0];
  const filtered = series.band.filter((b) => {
    if (currentStint && (b.day < currentStint.startDay || b.day > currentStint.endDay)) {
      return false;
    }
    return isDayInRangeBounds(b.day, bounds);
  });
  if (series.range !== "all") {
    return filtered;
  }
  // Align daily band points onto Monday weekly buckets for `range === "all"`.
  const byWeek = new Map<string, BandPointDTO>();
  for (const pt of filtered) {
    const weekStart = toWeekStartMonday(pt.day);
    byWeek.set(weekStart, { ...pt, day: weekStart });
  }
  return Array.from(byWeek.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Builds the recent-units table below the chart (B-F1: recent window counts
 * `usableLimit` usable non-minor units only; skipped partial units between/before
 * them appear as muted rows with "—" in vs-usual and partial reason in Notes).
 */
export function buildRecentUnitRows(series: MetricSeriesDTO, usableLimit = 7): RecentUnitRow[] {
  const baselined = hasEstablishedBaseline(series);
  const epochById = new Map(series.epochs.map((e) => [e.id, e]));
  const unitLabel = displayUnit(series.metric, series.unit);

  const dailyNonMinorByDay = new Map<string, MetricUnitPointDTO>();
  if (series.range !== "all") {
    const nonMinorDaily = series.units.filter((u) => !epochById.get(u.epochId)?.minor);
    for (const u of deduplicateUnitsByDay(nonMinorDaily, series)) {
      dailyNonMinorByDay.set(u.day, u);
    }
  }

  const finding = series.finding;
  if (finding && finding.sparkline.length > 0) {
    const orderedSparkline = [...finding.sparkline].sort((a, b) =>
      a.day < b.day ? 1 : a.day > b.day ? -1 : 0,
    );

    const selected: Array<{
      day: string;
      value: number | null;
      z: number | null;
      usable: boolean;
      deviceLabel: string;
      partialNote: string | null;
      tzChange: boolean;
      isRecent: boolean;
    }> = [];
    let usableCount = 0;

    for (const pt of orderedSparkline) {
      const daily = dailyNonMinorByDay.get(pt.day);
      const value = pt.value;
      const isUsable = (daily ? daily.usable : pt.usable) && value !== null;
      if (!isUsable && value === null && (!daily || daily.partialReason === "missing")) {
        continue;
      }
      const fallbackLabel =
        finding.epochLabel ?? (finding.epochId !== null ? `#${finding.epochId}` : "—");
      const deviceLabel = daily
        ? (epochById.get(daily.epochId)?.label ?? fallbackLabel)
        : fallbackLabel;
      selected.push({
        day: pt.day,
        value,
        z: pt.z,
        usable: isUsable,
        deviceLabel,
        partialNote: !isUsable
          ? (formatPartialReason(daily?.partialReason ?? null) ?? copy.chart.partialGeneric)
          : null,
        tzChange: daily?.tzChange ?? false,
        isRecent: isUsable && usableCount < usableLimit,
      });
      if (isUsable) {
        usableCount += 1;
        if (usableCount >= usableLimit) break;
      } else if (selected.length >= usableLimit + 7) {
        break;
      }
    }

    return selected.map((row) => {
      const valStr =
        row.value === null
          ? "—"
          : unitLabel
            ? `${formatMetricNumber(row.value, series.metric, series.unit)} ${unitLabel}`
            : formatMetricNumber(row.value, series.metric, series.unit);
      const effectiveZ = baselined && row.usable ? row.z : null;
      return {
        day: row.day,
        dayLabel: formatDayWithWeekday(row.day),
        valueText: valStr,
        zText: formatZScore(effectiveZ),
        zTone: zToneFor(effectiveZ),
        deviceLabel: row.deviceLabel,
        partialNote: row.partialNote,
        tzChange: row.tzChange,
        usable: row.usable,
        isRecent: row.isRecent,
      };
    });
  }

  const nonMinor = series.units.filter((u) => !epochById.get(u.epochId)?.minor);
  const sortedNonMinor = deduplicateUnitsByDay(nonMinor, series).sort((a, b) =>
    a.day < b.day ? 1 : a.day > b.day ? -1 : 0,
  );

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
  const currentStint = [...series.stints].sort((a, b) =>
    a.endDay < b.endDay ? 1 : a.endDay > b.endDay ? -1 : 0,
  )[0];
  const bandDays = series.band
    .filter(
      (b) => !currentStint || (b.day >= currentStint.startDay && b.day <= currentStint.endDay),
    )
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
  const bounds = getSeriesRangeBounds(series);
  const visibleSeams = series.seams.filter((s) => isDayInRangeBounds(s.seamDay, bounds));
  const seamText =
    visibleSeams.length > 0 && visibleSeams[0]
      ? `, ${visibleSeams.length} ${visibleSeams.length === 1 ? "device seam" : "device seams"} (${formatShortDay(visibleSeams[0].seamDay)})`
      : "";
  const nonMinorCount = series.epochs.filter((e) => !e.minor).length;
  const readingWord = numericUnits.length === 1 ? "reading" : "readings";
  const epochWord = nonMinorCount === 1 ? "primary epoch" : "primary epochs";

  return `${label}: ${numericUnits.length} ${readingWord}${span} ranging from ${minVal} to ${maxVal}${unitSuffix} across ${nonMinorCount} ${epochWord}${seamText}.`;
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
      const ep = epochById.get(u.epochId);
      const valStr =
        u.value === null
          ? "—"
          : unitLabel
            ? `${formatMetricNumber(u.value, series.metric, series.unit)} ${unitLabel}`
            : formatMetricNumber(u.value, series.metric, series.unit);
      return {
        day: u.day,
        value: valStr,
        device: ep?.label ?? `#${u.epochId}`,
        usable: u.usable ? "yes" : (u.partialReason ?? "partial"),
        bandLow: band ? formatMetricNumber(band.low, series.metric, series.unit) : "—",
        bandHigh: band ? formatMetricNumber(band.high, series.metric, series.unit) : "—",
      };
    }),
  };
}
