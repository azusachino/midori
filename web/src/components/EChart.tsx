import { BarChart, CustomChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  CalendarComponent,
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
import { useEffect, useRef, useState } from "react";
import { type ChartTheme, readChartTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

echarts.use([
  LineChart,
  ScatterChart,
  BarChart,
  CustomChart,
  CalendarComponent,
  GridComponent,
  AxisPointerComponent,
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

export interface EChartPointClickEvent {
  name: string;
  dataIndex: number;
  seriesName?: string | undefined;
  seriesType?: string | undefined;
}

export interface EChartProps {
  /** Builds the ECharts option using the resolved CSS-variable theme and container width. */
  buildOption: (theme: ChartTheme, width: number) => EChartsCoreOption;
  /** Accessible summary of the chart (ui-design §11). */
  summary: string;
  /** Optional tabular mirror rendered in a visually hidden table for screen readers. */
  table?: AccessibleTableData;
  /** Called after interactive dataZoom slider/inside gestures complete. */
  onDataZoom?: (event: EChartZoomEvent) => void;
  /** Called when a plotted series point is clicked. */
  onPointClick?: (event: EChartPointClickEvent) => void;
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
  onPointClick,
  className,
  height = 240,
  "data-testid": testId,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EChartsType | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const buildOptionRef = useRef(buildOption);
  buildOptionRef.current = buildOption;
  const onDataZoomRef = useRef(onDataZoom);
  onDataZoomRef.current = onDataZoom;
  const onPointClickRef = useRef(onPointClick);
  onPointClickRef.current = onPointClick;

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

    let lastHandledDomEvent: unknown = null;

    chart.on("click", (rawEvent: unknown) => {
      const handler = onPointClickRef.current;
      if (!handler || typeof rawEvent !== "object" || rawEvent === null) return;
      const ev = rawEvent as {
        componentType?: unknown;
        name?: unknown;
        dataIndex?: unknown;
        seriesName?: unknown;
        seriesType?: unknown;
        data?: { name?: unknown } | unknown;
        value?: unknown;
        event?: { event?: unknown };
      };
      if (ev.componentType !== "series") return;
      if (typeof ev.dataIndex !== "number") return;
      lastHandledDomEvent = ev.event?.event ?? null;
      const dataObj =
        typeof ev.data === "object" && ev.data !== null
          ? (ev.data as { name?: unknown })
          : undefined;
      const resolvedName =
        typeof ev.name === "string" && ev.name.length > 0
          ? ev.name
          : typeof dataObj?.name === "string" && dataObj.name.length > 0
            ? dataObj.name
            : Array.isArray(ev.value) && typeof ev.value[0] === "string"
              ? ev.value[0]
              : String(ev.name ?? "");
      handler({
        name: resolvedName,
        dataIndex: ev.dataIndex,
        seriesName: typeof ev.seriesName === "string" ? ev.seriesName : undefined,
        seriesType: typeof ev.seriesType === "string" ? ev.seriesType : undefined,
      });
    });

    chart.getZr().on("click", (rawZr: unknown) => {
      const handler = onPointClickRef.current;
      if (!handler || typeof rawZr !== "object" || rawZr === null) return;
      const zrEv = rawZr as { offsetX?: number; offsetY?: number; event?: unknown };
      if (zrEv.event && zrEv.event === lastHandledDomEvent) return;
      if (typeof zrEv.offsetX !== "number" || typeof zrEv.offsetY !== "number") return;
      const opt = chart.getOption() as { grid?: unknown[] } | undefined;
      if (!Array.isArray(opt?.grid) || opt.grid.length === 0) return;
      if (!chart.containPixel("grid", [zrEv.offsetX, zrEv.offsetY])) return;
      const coord = chart.convertFromPixel({ seriesIndex: 0 }, [zrEv.offsetX, zrEv.offsetY]) as
        | number[]
        | undefined;
      if (!Array.isArray(coord) || typeof coord[0] !== "number" || Number.isNaN(coord[0])) {
        return;
      }
      const dataIndex = Math.round(coord[0]);
      if (dataIndex < 0) return;
      handler({
        name: "",
        dataIndex,
        seriesType: "grid",
      });
    });

    let lastObservedWidth = el.clientWidth || chart.getWidth();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            chart.resize();
            const nextWidth = el.clientWidth || chart.getWidth();
            if (Math.abs(nextWidth - lastObservedWidth) >= 8) {
              lastObservedWidth = nextWidth;
              if (buildOptionRef.current.length >= 2) {
                setContainerWidth(nextWidth);
              }
            }
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
    const el = containerRef.current;
    if (!chart || !el) return;
    const theme = readChartTheme();
    const resolvedWidth = containerWidth > 0 ? containerWidth : el.clientWidth || chart.getWidth();
    chart.setOption(
      {
        animation: false,
        textStyle: {
          color: theme.mutedForeground,
          fontFamily: theme.fontSans,
        },
        ...buildOption(theme, resolvedWidth),
      },
      { notMerge: true },
    );
  }, [buildOption, containerWidth]);

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
