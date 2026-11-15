import type {
  CheckResultDTO,
  ConfidenceLevel,
  FindingRowDTO,
  SparklinePointDTO,
} from "../api/types";
import { DAYTIME_ORDER, OVERNIGHT_ORDER } from "./metrics";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseIsoDayUtc(isoDay: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month, day));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Formats "2026-03-01" as "Mar 1" using UTC calendar fields (no host-TZ drift). */
export function formatShortDay(isoDay: string): string {
  const dt = parseIsoDayUtc(isoDay);
  if (!dt) return isoDay;
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** Formats "2026-03-01" as "Mar 1 (Sun)". */
export function formatDayWithWeekday(isoDay: string): string {
  const dt = parseIsoDayUtc(isoDay);
  if (!dt) return isoDay;
  const wd = WEEKDAYS[dt.getUTCDay()];
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()} (${wd})`;
}

/** Formats a date span such as "Oct 28–Nov 7". */
export function formatRangeSpan(fromDay: string, toDay: string): string {
  return `${formatShortDay(fromDay)}–${formatShortDay(toDay)}`;
}

/** Human-facing unit token paired with a metric key. */
export function displayUnit(metric: string, unit: string): string {
  if (metric === "resp_rate") return "/min";
  if (unit === "degC") return "°C";
  if (unit === "count/min") return "bpm";
  if (metric === "steps" || unit === "count") return "";
  return unit;
}

/** Formats a single numeric reading concisely with appropriate precision. */
export function formatMetricNumber(value: number, metric: string, unit: string): string {
  if (metric === "steps" || unit === "kJ") {
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return Math.round(value).toString();
  }
  if (metric === "wrist_temp" || unit === "degC") {
    return value.toFixed(2);
  }
  if (unit === "h" || metric === "resp_rate" || unit === "%") {
    return value.toFixed(1);
  }
  if (Math.abs(value) < 10) {
    return value.toFixed(1);
  }
  return Math.round(value).toLocaleString();
}

/** Formats recent vs baseline median pair, e.g. "42 vs 55 ms" or "9.1k vs 6.0k". */
export function formatRecentVsBaseline(row: FindingRowDTO): string | null {
  if (row.recentMedian === null || row.baselineMedian === null) return null;
  if (row.unit === "%" && (row.recentMedian < 1.5 || row.baselineMedian < 1.5)) {
    return null;
  }
  const recent = formatMetricNumber(row.recentMedian, row.metric, row.unit);
  const base = formatMetricNumber(row.baselineMedian, row.metric, row.unit);
  const unitLabel = displayUnit(row.metric, row.unit);
  return unitLabel ? `${recent} vs ${base} ${unitLabel}` : `${recent} vs ${base}`;
}

export function unitNounFor(kind: FindingRowDTO["kind"]): "nights" | "days" {
  return kind === "daytime" ? "days" : "nights";
}

export function flaggedChecksFor(row: FindingRowDTO): CheckResultDTO[] {
  return row.checks.filter((c) => c.flagged);
}

const REGISTRY_RANK = new Map<string, number>([
  ...OVERNIGHT_ORDER.map((k, i) => [k, i] as const),
  ...DAYTIME_ORDER.map((k, i) => [k, i + 100] as const),
]);

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function stateRank(state: FindingRowDTO["state"]): number {
  if (state === "computed") return 0;
  if (state === "warming_up") return 1;
  return 2;
}

/**
 * Applies B-F7 ordering:
 * 1. Computed rows by capped |z| (<=10) desc, confidence high->low, registry order.
 * 2. warming_up rows in registry order.
 * 3. insufficient / stale rows in registry order.
 */
export function rankFindingRows(rows: readonly FindingRowDTO[]): FindingRowDTO[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sDiff = stateRank(a.row.state) - stateRank(b.row.state);
      if (sDiff !== 0) return sDiff;

      if (a.row.state === "computed") {
        const az = Math.min(10, Math.abs(a.row.z ?? 0));
        const bz = Math.min(10, Math.abs(b.row.z ?? 0));
        if (bz !== az) return bz - az;

        const ac = a.row.confidence ? CONFIDENCE_RANK[a.row.confidence] : 3;
        const bc = b.row.confidence ? CONFIDENCE_RANK[b.row.confidence] : 3;
        if (ac !== bc) return ac - bc;
      }

      const ar = REGISTRY_RANK.get(a.row.metric) ?? 999;
      const br = REGISTRY_RANK.get(b.row.metric) ?? 999;
      if (ar !== br) return ar - br;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

export function isNotableDaytime(row: FindingRowDTO): boolean {
  return row.severity === "notable" || row.severity === "alert";
}

export function isAllWithin(
  overnight: readonly FindingRowDTO[],
  daytime: readonly FindingRowDTO[],
): boolean {
  if (overnight.length === 0) return false;
  const allOvernightWithin = overnight.every(
    (r) => r.state === "computed" && r.severity === "within",
  );
  const anyDaytime = daytime.some(isNotableDaytime);
  return allOvernightWithin && !anyDaytime;
}

export interface SparklinePlottedPoint {
  x: number;
  y: number;
  usable: boolean;
  isRecent: boolean;
  clipped: "high" | "low" | null;
}

export interface SparklineGeometry {
  width: number;
  height: number;
  bandRect: { y: number; height: number } | null;
  recentSplitX: number | null;
  baselineSegments: string[];
  recentSegments: string[];
  points: SparklinePlottedPoint[];
  hasClipped: boolean;
}

/**
 * Computes normalized SVG coordinates for a 35-unit sparkline:
 * - baseline [baselineLow, baselineHigh] shaded horizontal band
 * - last 7 points emphasized
 * - |z| >= 10 points clamped to top/bottom plot bounds with a clip marker (B-F4 cap)
 */
export function buildSparklineGeometry(
  rawPoints: readonly SparklinePointDTO[],
  baselineLow: number | null,
  baselineHigh: number | null,
  width = 88,
  height = 24,
): SparklineGeometry {
  const padX = 3;
  const padY = 3;
  const plotW = Math.max(1, width - padX * 2);
  const plotH = Math.max(1, height - padY * 2);
  const count = rawPoints.length;

  const usableNumeric = rawPoints.filter(
    (p) => p.value !== null && (p.z === null || Math.abs(p.z) < 10),
  );
  const allNumeric = rawPoints.filter((p) => p.value !== null);
  const domainValues = (usableNumeric.length > 0 ? usableNumeric : allNumeric).map(
    (p) => p.value as number,
  );
  if (baselineLow !== null) domainValues.push(baselineLow);
  if (baselineHigh !== null) domainValues.push(baselineHigh);

  let minVal = domainValues.length > 0 ? Math.min(...domainValues) : 0;
  let maxVal = domainValues.length > 0 ? Math.max(...domainValues) : 1;
  if (maxVal === minVal) {
    minVal -= 1;
    maxVal += 1;
  }

  const xAt = (idx: number) => (count <= 1 ? width / 2 : padX + (idx / (count - 1)) * plotW);

  const yAtValue = (val: number) => {
    const ratio = (val - minVal) / (maxVal - minVal);
    const clamped = Math.max(0, Math.min(1, ratio));
    return padY + (1 - clamped) * plotH;
  };

  let bandRect: { y: number; height: number } | null = null;
  if (baselineLow !== null && baselineHigh !== null) {
    const yTop = yAtValue(Math.max(baselineLow, baselineHigh));
    const yBottom = yAtValue(Math.min(baselineLow, baselineHigh));
    bandRect = { y: yTop, height: Math.max(2, yBottom - yTop) };
  }

  const recentStartIdx = Math.max(0, count - 7);
  const recentSplitX = count > 7 ? xAt(recentStartIdx) : null;

  const plotted: Array<SparklinePlottedPoint | null> = rawPoints.map((p, idx) => {
    if (p.value === null) return null;
    const isRecent = idx >= recentStartIdx;
    let clipped: "high" | "low" | null = null;
    let y = yAtValue(p.value);
    if (p.z !== null && Math.abs(p.z) >= 10) {
      clipped = p.z > 0 ? "high" : "low";
      y = clipped === "high" ? padY : height - padY;
    }
    return {
      x: Number(xAt(idx).toFixed(1)),
      y: Number(y.toFixed(1)),
      usable: p.usable,
      isRecent,
      clipped,
    };
  });

  const baselineSegments: string[] = [];
  const recentSegments: string[] = [];
  let currentPath: string[] = [];
  let currentIsRecent = false;

  const flush = () => {
    if (currentPath.length >= 2) {
      (currentIsRecent ? recentSegments : baselineSegments).push(currentPath.join(" "));
    }
    currentPath = [];
  };

  for (let idx = 0; idx < plotted.length; idx++) {
    const pt = plotted[idx];
    if (!pt) {
      flush();
      continue;
    }
    if (idx === recentStartIdx && currentPath.length > 0 && !currentIsRecent) {
      // Bridge the boundary into the recent-7 segment cleanly without duplicating
      const lastPrev = plotted[idx - 1];
      flush();
      if (lastPrev) {
        currentIsRecent = true;
        currentPath.push(`M${lastPrev.x},${lastPrev.y}`);
        currentPath.push(`L${pt.x},${pt.y}`);
        continue;
      }
    }
    if (currentPath.length === 0) {
      currentIsRecent = pt.isRecent;
      currentPath.push(`M${pt.x},${pt.y}`);
    } else {
      currentPath.push(`L${pt.x},${pt.y}`);
    }
  }
  flush();

  const points = plotted.filter((p): p is SparklinePlottedPoint => p !== null);
  return {
    width,
    height,
    bandRect,
    recentSplitX: recentSplitX !== null ? Number(recentSplitX.toFixed(1)) : null,
    baselineSegments,
    recentSegments,
    points,
    hasClipped: points.some((p) => p.clipped !== null),
  };
}
