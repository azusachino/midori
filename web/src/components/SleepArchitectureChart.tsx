import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useMemo } from "react";
import { EChart } from "@/components/EChart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/copy";
import { formatShortDay } from "@/lib/finding-format";
import type { ChartTheme } from "@/lib/theme";
import { seriesFor, type TrendsData } from "@/lib/trends";
import { cn } from "@/lib/utils";

export interface SleepArchitectureChartProps {
  data: TrendsData;
  rangeLabel: string;
  height?: number;
  className?: string;
}

function cellText(value: number | null): string {
  return value === null ? copy.pages.trends.noValue : value.toFixed(1);
}

/**
 * B-T1: stacked Deep / REM / Core bars over an ascending night axis, with the usual
 * sleep median, a partial-night marker and personal-note bands. The palette matches
 * the Last-night stage bar so the two views agree.
 */
export function SleepArchitectureChart({
  data,
  rangeLabel,
  height = 280,
  className,
}: SleepArchitectureChartProps) {
  const summary = useMemo(
    () =>
      copy.pages.trends.sleepSummary(
        data.nights.length,
        rangeLabel,
        data.usualSleepMedian === null ? null : `${data.usualSleepMedian.toFixed(1)} h`,
      ),
    [data.nights.length, data.usualSleepMedian, rangeLabel],
  );

  const table = useMemo(
    () => ({
      columns: [
        { key: "day", label: copy.pages.trends.columns.day },
        { key: "deep", label: copy.pages.trends.columns.deep },
        { key: "rem", label: copy.pages.trends.columns.rem },
        { key: "core", label: copy.pages.trends.columns.core },
        { key: "asleep", label: copy.pages.trends.columns.asleep },
      ],
      rows: data.nights.map((night) => ({
        day: night.date,
        deep: cellText(night.deepH),
        rem: cellText(night.remH),
        core: cellText(night.coreH),
        asleep: cellText(night.asleepH),
      })),
    }),
    [data.nights],
  );

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const days = data.days;
      const interval = Math.max(0, Math.ceil(days.length / 8) - 1);
      const noteAreas = data.noteBands.flatMap((band) => {
        const start = days[band.startIndex];
        const end = days[band.endIndex];
        if (!start || !end) return [];
        return [
          [
            {
              xAxis: start,
              itemStyle: { color: theme.accent, opacity: 0.1 },
              label: {
                show: true,
                position: "insideTop" as const,
                color: theme.mutedForeground,
                fontSize: 10,
                formatter: band.label,
              },
            },
            { xAxis: end },
          ],
        ];
      });

      return {
        grid: { left: 40, right: 16, top: 26, bottom: 30 },
        legend: {
          data: [
            copy.pages.changes.lastNight.stageLegend.deep,
            copy.pages.changes.lastNight.stageLegend.rem,
            copy.pages.changes.lastNight.stageLegend.core,
          ],
          top: 0,
          right: 0,
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 10,
          textStyle: { color: theme.mutedForeground, fontSize: 11 },
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.foreground, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: days,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: theme.borderStrong } },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 10,
            interval,
            formatter: (value: string) => formatShortDay(value),
          },
        },
        yAxis: {
          type: "value",
          name: "h",
          nameTextStyle: { color: theme.mutedForeground, fontSize: 10 },
          axisLabel: { color: theme.mutedForeground, fontSize: 10 },
          splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
        },
        series: [
          {
            name: copy.pages.changes.lastNight.stageLegend.deep,
            type: "bar",
            stack: "sleep",
            barMaxWidth: 20,
            itemStyle: { color: theme.epochs[1] ?? theme.accent },
            data: seriesFor(data, "deepH"),
          },
          {
            name: copy.pages.changes.lastNight.stageLegend.rem,
            type: "bar",
            stack: "sleep",
            barMaxWidth: 20,
            itemStyle: { color: theme.learning },
            data: seriesFor(data, "remH"),
          },
          {
            name: copy.pages.changes.lastNight.stageLegend.core,
            type: "bar",
            stack: "sleep",
            barMaxWidth: 20,
            itemStyle: { color: theme.mutedForeground, opacity: 0.45 },
            data: seriesFor(data, "coreH"),
            ...(noteAreas.length > 0 ? { markArea: { silent: true, data: noteAreas } } : {}),
            ...(data.usualSleepMedian === null
              ? {}
              : {
                  markLine: {
                    silent: true,
                    symbol: "none",
                    lineStyle: { color: theme.accent, type: "dashed" as const, width: 1.25 },
                    label: {
                      color: theme.accent,
                      fontSize: 10,
                      position: "insideStartTop" as const,
                      formatter: copy.pages.trends.usualMedianLabel,
                    },
                    data: [{ yAxis: data.usualSleepMedian }],
                  },
                }),
          },
          {
            name: copy.pages.trends.partialLabel,
            type: "scatter",
            symbol: "triangle",
            symbolSize: 8,
            itemStyle: { color: theme.partial },
            data: data.nights.map((night) => (night.partialReason === null ? null : 0)),
          },
        ],
      };
    },
    [data],
  );

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="space-y-1 pb-2">
        <h2 className="midori-kicker">{copy.pages.trends.sleepTitle}</h2>
        <p className="text-xs text-muted-foreground">{copy.pages.trends.sleepSubtitle}</p>
      </CardHeader>
      <CardContent>
        <EChart
          buildOption={buildOption}
          summary={summary}
          table={table}
          height={height}
          data-testid="sleep-architecture-echart"
        />
      </CardContent>
    </Card>
  );
}
