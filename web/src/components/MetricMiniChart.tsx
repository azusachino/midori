import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useMemo } from "react";
import type { MetricIndexEntryDTO } from "@/api/types";
import { EChart } from "@/components/EChart";
import { formatMetricNumber, formatShortDay } from "@/lib/finding-format";
import { shouldIncludeZero } from "@/lib/metric-chart";
import {
  buildEpochWeeklySegments,
  buildMiniChartSummary,
  buildMiniChartTable,
  resolveWeeklySeamWeek,
} from "@/lib/metrics-index";
import { type ChartTheme, epochColor } from "@/lib/theme";

export interface MetricMiniChartProps {
  entry: MetricIndexEntryDTO;
  epochLabels?: ReadonlyMap<number, string> | undefined;
  epochColors?: ReadonlyMap<number, number | null> | undefined;
  height?: number;
}

/** 1-year weekly mini chart on the /metrics index with epoch colors and dashed seam lines. */
export function MetricMiniChart({
  entry,
  epochLabels,
  epochColors,
  height = 112,
}: MetricMiniChartProps) {
  const segments = useMemo(
    () => buildEpochWeeklySegments(entry.weeklySeries, epochColors),
    [entry.weeklySeries, epochColors],
  );
  const summary = useMemo(() => buildMiniChartSummary(entry), [entry]);
  const table = useMemo(() => buildMiniChartTable(entry, epochLabels), [entry, epochLabels]);

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const weeks = entry.weeklySeries.map((pt) => pt.weekStart);

      const seamMarkLines = entry.seams
        .map((s) => resolveWeeklySeamWeek(entry.weeklySeries, s.day))
        .filter((wk): wk is string => wk !== null)
        .map((wk) => ({
          xAxis: wk,
          lineStyle: { color: theme.borderStrong, type: "dashed" as const, width: 1 },
        }));

      const echartsSeries = segments.map((seg, idx) => {
        const color = epochColor(seg.colorIndex, theme.epochs);
        const nonNullCount = seg.points.filter((p) => p.median !== null).length;
        const seriesName =
          epochLabels?.get(seg.epochId) ??
          (entry.finding?.epochId === seg.epochId ? entry.finding.epochLabel : null) ??
          `Epoch ${seg.epochId}`;
        return {
          name: seriesName,
          type: "line" as const,
          connectNulls: false,
          showSymbol: nonNullCount <= 1,
          symbolSize: nonNullCount <= 1 ? 5.5 : 4,
          lineStyle: { color, width: 1.5 },
          itemStyle: { color },
          data: seg.points.map((p) => {
            if (p.median === null) return null;
            if (p.hasPartial) {
              return {
                value: p.median,
                showSymbol: true,
                symbol: "emptyCircle",
                symbolSize: 5,
                itemStyle: { color: theme.card, borderColor: color, borderWidth: 1.5 },
              };
            }
            return p.median;
          }),
          ...(idx === 0 && seamMarkLines.length > 0
            ? {
                markLine: {
                  symbol: ["none", "none"],
                  silent: true,
                  label: { show: false },
                  data: seamMarkLines,
                },
              }
            : {}),
        };
      });

      return {
        grid: {
          top: 8,
          right: 12,
          bottom: 20,
          left: 38,
        },
        xAxis: {
          type: "category",
          data: weeks,
          boundaryGap: false,
          axisLine: { lineStyle: { color: theme.border } },
          axisTick: { show: false },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 10,
            interval: Math.max(1, Math.floor(weeks.length / 4)),
            formatter: (val: string) => formatShortDay(val),
          },
        },
        yAxis: {
          type: "value",
          scale: !shouldIncludeZero(entry.metric),
          min: shouldIncludeZero(entry.metric) ? 0 : undefined,
          splitNumber: 2,
          splitLine: { lineStyle: { color: theme.border } },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 10,
            formatter: (val: number) => formatMetricNumber(val, entry.metric, entry.unit),
          },
        },
        series: echartsSeries,
      };
    },
    [entry, epochLabels, segments],
  );

  return (
    <EChart
      data-testid={`metric-mini-chart-${entry.metric}`}
      height={height}
      buildOption={buildOption}
      summary={summary}
      table={table}
    />
  );
}
