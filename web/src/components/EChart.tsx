import { CustomChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { type ChartTheme, readChartTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

echarts.use([
  LineChart,
  ScatterChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer,
]);

export interface AccessibleTableColumn {
  key: string;
  label: string;
}

export interface AccessibleTableData {
  columns: readonly AccessibleTableColumn[];
  rows: ReadonlyArray<Record<string, string | number | boolean | null | undefined>>;
}

export interface EChartZoomEvent {
  start: number;
  end: number;
  startValue?: string | number | undefined;
  endValue?: string | number | undefined;
}

export interface EChartProps {
  /** Builds the ECharts option using the resolved CSS-variable theme. */
  buildOption: (theme: ChartTheme) => EChartsCoreOption;
  /** Accessible summary of the chart (ui-design §11). */
  summary: string;
  /** Optional tabular mirror rendered in a visually hidden table for screen readers. */
  table?: AccessibleTableData;
  /** Called after interactive dataZoom slider/inside gestures complete. */
  onDataZoom?: (event: EChartZoomEvent) => void;
  className?: string;
  height?: number;
  "data-testid"?: string;
}

interface RawDataZoomOption {
  start?: number;
  end?: number;
  startValue?: string | number;
  endValue?: string | number;
}

/**
 * Shared ECharts wrapper (ui-design §10): per-module imports, CSS-variable theme,
 * ResizeObserver resize, strict cleanup on unmount, animation disabled (§9).
 */
export function EChart({
  buildOption,
  summary,
  table,
  onDataZoom,
  className,
  height = 240,
  "data-testid": testId,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EChartsType | null>(null);
  const onDataZoomRef = useRef(onDataZoom);
  onDataZoomRef.current = onDataZoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    chart.on("datazoom", (rawEvent: unknown) => {
      const handler = onDataZoomRef.current;
      if (!handler) return;
      const opt = chart.getOption() as { dataZoom?: RawDataZoomOption[] } | undefined;
      const resolved = opt?.dataZoom?.[0];
      const evObj = rawEvent as {
        batch?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }>;
        start?: number;
        end?: number;
        startValue?: number;
        endValue?: number;
      };
      const firstBatch = evObj.batch?.[0];
      const start = firstBatch?.start ?? evObj.start ?? resolved?.start ?? 0;
      const end = firstBatch?.end ?? evObj.end ?? resolved?.end ?? 100;
      handler({
        start,
        end,
        startValue: firstBatch?.startValue ?? evObj.startValue ?? resolved?.startValue,
        endValue: firstBatch?.endValue ?? evObj.endValue ?? resolved?.endValue,
      });
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            chart.resize();
          })
        : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;
    const theme = readChartTheme();
    chart.setOption(
      {
        animation: false,
        textStyle: {
          color: theme.mutedForeground,
          fontFamily: theme.fontSans,
        },
        ...buildOption(theme),
      },
      { notMerge: true },
    );
  }, [buildOption]);

  return (
    <figure
      className={cn("relative w-full min-w-0 overflow-hidden", className)}
      data-testid={testId}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label={summary}
        style={{ height: `${height}px` }}
        className="w-full overflow-hidden"
      />
      <figcaption className="sr-only">{summary}</figcaption>
      {table && table.rows.length > 0 ? (
        <div className="sr-only">
          <table>
            <caption>{summary}</caption>
            <thead>
              <tr>
                {table.columns.map((col) => (
                  <th key={col.key} scope="col">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const rowKey = table.columns.map((c) => String(row[c.key] ?? "")).join("|");
                return (
                  <tr key={rowKey}>
                    {table.columns.map((col) => (
                      <td key={col.key}>{String(row[col.key] ?? "")}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
