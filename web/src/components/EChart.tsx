import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { type ChartTheme, readChartTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface AccessibleTableColumn {
  key: string;
  label: string;
}

export interface AccessibleTableData {
  columns: readonly AccessibleTableColumn[];
  rows: ReadonlyArray<Record<string, string | number | boolean | null | undefined>>;
}

export interface EChartProps {
  /** Builds the ECharts option using the resolved CSS-variable theme. */
  buildOption: (theme: ChartTheme) => EChartsCoreOption;
  /** Accessible summary of the chart (ui-design §11). */
  summary: string;
  /** Optional tabular mirror rendered in a visually hidden table for screen readers. */
  table?: AccessibleTableData;
  className?: string;
  height?: number;
  "data-testid"?: string;
}

/**
 * Shared ECharts wrapper (ui-design §10): per-module imports, CSS-variable theme,
 * ResizeObserver resize, strict cleanup on unmount, animation disabled (§9).
 */
export function EChart({
  buildOption,
  summary,
  table,
  className,
  height = 240,
  "data-testid": testId,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    instanceRef.current = chart;

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
    <figure className={cn("w-full", className)} data-testid={testId}>
      <div
        ref={containerRef}
        role="img"
        aria-label={summary}
        style={{ height: `${height}px` }}
        className="w-full"
      />
      <figcaption className="sr-only">{summary}</figcaption>
      {table && table.rows.length > 0 ? (
        <table className="sr-only">
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
      ) : null}
    </figure>
  );
}
