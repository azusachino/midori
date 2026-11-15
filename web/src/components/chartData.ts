import type { AlignedData, Options } from "uplot";

/**
 * Pure chart plumbing for the uPlot wrapper (Chart.tsx stays a thin component).
 * Everything here is unit-testable without a canvas: data alignment, series/band
 * config, and boundary-line drawing against injected drawing primitives.
 */

export interface ChartPoint {
  day: string;
  value: number;
}

export interface ChartBand {
  /** Inclusive band edges; null band renders no envelope. */
  low: number;
  high: number;
}

export interface ChartSeries {
  label: string;
  points: ChartPoint[];
  /** Optional baseline envelope drawn behind this series. */
  band?: ChartBand | null;
}

/** Days (YYYY-MM-DD) where a device seam or coverage boundary gets a vertical marker. */
export type BoundaryDay = string;

export const DAY_MS = 86_400_000;

/** Series colors from tokens.css (single palette, dark-first). */
export const SERIES_COLORS = ["#7aa7ff", "#5fbf8a", "#d8b25c", "#d9807e", "#a3acba"] as const;
const BAND_FILL = "rgba(122, 167, 255, 0.10)";
const BOUNDARY_COLOR = "#3a4250";

/** UTC midnight timestamp for a YYYY-MM-DD string (stable axis alignment). */
export function dayToTs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function tsToDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export interface BuiltChart {
  data: AlignedData;
  /** uPlot series options; data index 0 is the shared x axis. */
  series: Options["series"];
  /** Band index pairs for uPlot's `bands` option. */
  bands: { series: [number, number] }[];
  /** Labels of visible (legend) series in data order after the x axis. */
  labels: string[];
}

/**
 * Aligns sparse per-source series onto the sorted union of days. Each series with a
 * band contributes two hidden series (low/high) right after it; uPlot fills between
 * them, which reads as the baseline envelope.
 */
export function buildChartData(series: ChartSeries[]): BuiltChart {
  const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))].sort();
  const xs = days.map(dayToTs);
  const byDay = series.map((s) => new Map(s.points.map((p) => [p.day, p.value])));

  const data: (number | null)[][] = [xs];
  const built: NonNullable<Options["series"]> = [{}];
  const bands: { series: [number, number] }[] = [];
  const labels: string[] = [];

  series.forEach((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length] ?? "#7aa7ff";
    if (si !== undefined && s.band) {
      // hidden low series, visible series, hidden high series — band between low and high
      const idxLow = data.length;
      data.push(days.map(() => s.band?.low ?? null));
      data.push(days.map((d) => byDay[si]?.get(d) ?? null));
      const idxHigh = data.length;
      data.push(days.map(() => s.band?.high ?? null));
      built.push({ label: `${s.label} low`, show: false });
      built.push({
        label: s.label,
        stroke: color,
        width: 2,
        points: { show: false },
        spanGaps: false,
      });
      built.push({ label: `${s.label} high`, show: false, fill: BAND_FILL });
      bands.push({ series: [idxLow, idxHigh] });
      labels.push(s.label);
    } else {
      data.push(days.map((d) => byDay[si]?.get(d) ?? null));
      built.push({
        label: s.label,
        stroke: color,
        width: 2,
        points: { show: false },
        spanGaps: false,
      });
      labels.push(s.label);
    }
  });

  return { data: data as unknown as AlignedData, series: built, bands, labels };
}

/** Minimal drawing surface drawBoundaries needs; uPlot satisfies it, tests fake it. */
export interface BoundarySurface {
  valToPos(v: number, scale: string, canvasPixels?: boolean): number;
  bbox: { top: number; height: number };
  ctx: {
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    /** Assignable stroke style (implementations may also expose a getter). */
    strokeStyle: CanvasRenderingContext2D["strokeStyle"];
    setLineDash?(segments: number[]): void;
  };
}

/** Draws one dashed vertical line per boundary day, inside the plot area only. */
export function drawBoundaryDays(u: BoundarySurface, days: BoundaryDay[]): void {
  if (days.length === 0) return;
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = BOUNDARY_COLOR;
  ctx.setLineDash?.([4, 3]);
  ctx.beginPath();
  for (const day of days) {
    const x = u.valToPos(dayToTs(day), "x", true);
    ctx.moveTo(x, u.bbox.top);
    ctx.lineTo(x, u.bbox.top + u.bbox.height);
  }
  ctx.stroke();
  ctx.restore();
}

export function dayFmt(ts: number): string {
  return tsToDay(ts);
}

export function valueFmt(v: number): string {
  // JS number→string is already minimal-form (6.5 → "6.5", 36.29 → "36.29").
  return String(Math.round(v * 100) / 100);
}
