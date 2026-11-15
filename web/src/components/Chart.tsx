import { useEffect, useMemo, useRef } from "react";
import type { Options } from "uplot";
import uPlot from "uplot";
import {
  type BoundaryDay,
  buildChartData,
  type ChartSeries,
  dayFmt,
  drawBoundaryDays,
  valueFmt,
} from "./chartData";

/**
 * uPlot wrapper (T16). Renders aligned per-source daily series with optional baseline
 * bands and device-seam boundary markers. All data plumbing lives in chartData.ts;
 * this component only owns the uPlot lifecycle (create → resize → destroy).
 */

export interface ChartProps {
  series: ChartSeries[];
  boundaryDays?: BoundaryDay[];
  unit?: string | null;
  height?: number;
  /** Value format for the cursor legend; defaults to 2-decimal trimming. */
  formatValue?: (v: number) => string;
}

const GRID = "#2a303b";
const AXIS = "#a3acba";
const FALLBACK_WIDTH = 640;

export function Chart({
  series,
  boundaryDays = [],
  unit = null,
  height = 260,
  formatValue = valueFmt,
}: ChartProps) {
  const holder = useRef<HTMLDivElement>(null);
  const built = useMemo(() => buildChartData(series), [series]);

  useEffect(() => {
    const el = holder.current;
    if (!el || built.data[0].length === 0) return;

    const opts: Options = {
      width: el.clientWidth || FALLBACK_WIDTH,
      height,
      bands: built.bands,
      series: built.series,
      axes: [
        {
          stroke: AXIS,
          grid: { stroke: GRID },
          values: (_, ts) => ts.map(dayFmt),
        },
        {
          stroke: AXIS,
          grid: { stroke: GRID },
          size: 64,
          values: (_u, vals) => vals.map((v) => formatValue(v) + (unit ? ` ${unit}` : "")),
        },
      ],
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
      hooks: {
        draw: [
          (u) => {
            drawBoundaryDays(u, boundaryDays);
          },
        ],
      },
    };

    const plot = new uPlot(opts, built.data, el);
    const onResize = () => {
      const w = el.clientWidth;
      if (w > 0) plot.setSize({ width: w, height });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [built, boundaryDays, height, formatValue, unit]);

  const desc = built.labels.join(", ");
  return <div className="chart" ref={holder} role="img" aria-label={`chart: ${desc}`} />;
}
