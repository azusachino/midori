import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useMemo } from "react";
import { EChart } from "@/components/EChart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/copy";
import { formatMetricNumber, formatShortDay } from "@/lib/finding-format";
import type { ChartTheme } from "@/lib/theme";
import { seriesFor, type TrendsData } from "@/lib/trends";
import { cn } from "@/lib/utils";

export interface CorrelatedVitalsChartProps {
  data: TrendsData;
  rangeLabel: string;
  height?: number;
  className?: string;
}

type PanelKey = "sleep" | "hrv" | "rhr" | "wristTemp";

const PANELS: ReadonlyArray<{
  key: PanelKey;
  series: "asleepH" | "hrvSdnn" | "rhr" | "wristTemp";
  metric: string;
  color: (theme: ChartTheme) => string;
  format: (value: number) => string;
}> = [
  {
    key: "sleep",
    series: "asleepH",
    metric: "sleep_h",
    color: (theme) => theme.epochs[1] ?? theme.accent,
    format: (value) => `${value.toFixed(1)} h`,
  },
  {
    key: "hrv",
    series: "hrvSdnn",
    metric: "hrv_sdnn",
    color: (theme) => theme.epochs[0] ?? theme.accent,
    format: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "rhr",
    series: "rhr",
    metric: "rhr",
    color: (theme) => theme.alert,
    format: (value) => `${Math.round(value)} bpm`,
  },
  {
    key: "wristTemp",
    series: "wristTemp",
    metric: "wrist_temp",
    color: (theme) => theme.notable,
    format: (value) => `${formatMetricNumber(value, "wrist_temp", "degC")} °C`,
  },
];

const GRID_GAP = 22;
const GRID_TOP = 12;
const GRID_BOTTOM = 30;

/**
 * B-T1: four synchronized panels (Sleep, HRV SDNN, Resting HR, Wrist temp) sharing one
 * ascending night axis. `axisPointer.link` ties the crosshair across grids, and personal
 * notes shade the same night range in every panel.
 */
export function CorrelatedVitalsChart({
  data,
  rangeLabel,
  height = 380,
  className,
}: CorrelatedVitalsChartProps) {
  const summary = useMemo(
    () => copy.pages.trends.vitalsSummary(data.nights.length, rangeLabel),
    [data.nights.length, rangeLabel],
  );

  const table = useMemo(
    () => ({
      columns: [
        { key: "day", label: copy.pages.trends.columns.day },
        { key: "sleep", label: copy.pages.trends.columns.asleep },
        { key: "hrv", label: copy.pages.trends.columns.hrv },
        { key: "rhr", label: copy.pages.trends.columns.rhr },
        { key: "wristTemp", label: copy.pages.trends.columns.wristTemp },
      ],
      rows: data.nights.map((night) => ({
        day: night.date,
        sleep: night.asleepH === null ? copy.pages.trends.noValue : night.asleepH.toFixed(1),
        hrv: night.hrvSdnn === null ? copy.pages.trends.noValue : Math.round(night.hrvSdnn),
        rhr: night.rhr === null ? copy.pages.trends.noValue : Math.round(night.rhr),
        wristTemp:
          night.wristTemp === null
            ? copy.pages.trends.noValue
            : formatMetricNumber(night.wristTemp, "wrist_temp", "degC"),
      })),
    }),
    [data.nights],
  );

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const days = data.days;
      const panelCount = PANELS.length;
      const usable = Math.max(120, height - GRID_TOP - GRID_BOTTOM - GRID_GAP * (panelCount - 1));
      const panelHeight = usable / panelCount;
      const interval = Math.max(0, Math.ceil(days.length / 8) - 1);

      const noteAreas = data.noteBands.flatMap((band) => {
        const start = days[band.startIndex];
        const end = days[band.endIndex];
        if (!start || !end) return [];
        return [
          [{ xAxis: start, itemStyle: { color: theme.accent, opacity: 0.1 } }, { xAxis: end }],
        ];
      });

      const grids = PANELS.map((_, index) => ({
        left: 74,
        right: 16,
        top: GRID_TOP + index * (panelHeight + GRID_GAP),
        height: panelHeight,
        containLabel: false,
      }));

      return {
        grid: grids,
        axisPointer: {
          link: [{ xAxisIndex: "all" }],
          label: { backgroundColor: theme.borderStrong },
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: theme.borderStrong } },
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.foreground, fontSize: 12 },
        },
        xAxis: PANELS.map((_, index) => ({
          type: "category" as const,
          gridIndex: index,
          data: days,
          boundaryGap: false,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: theme.borderStrong } },
          axisLabel: {
            show: index === panelCount - 1,
            color: theme.mutedForeground,
            fontSize: 10,
            interval,
            formatter: (value: string) => formatShortDay(value),
          },
        })),
        yAxis: PANELS.map((panel, index) => ({
          type: "value" as const,
          gridIndex: index,
          scale: true,
          name: copy.pages.trends.panelLabels[panel.key],
          nameLocation: "middle" as const,
          nameRotate: 90,
          nameGap: 46,
          nameTextStyle: { color: theme.mutedForeground, fontSize: 10 },
          splitNumber: 2,
          axisLabel: { color: theme.mutedForeground, fontSize: 9 },
          splitLine: { lineStyle: { color: theme.border, type: "dashed" as const } },
        })),
        series: PANELS.map((panel, index) => ({
          name: copy.pages.trends.panelLabels[panel.key],
          type: "line" as const,
          xAxisIndex: index,
          yAxisIndex: index,
          connectNulls: false,
          showSymbol: days.length <= 14,
          symbolSize: 4,
          lineStyle: { color: panel.color(theme), width: 1.75 },
          itemStyle: { color: panel.color(theme) },
          // Soft vertical fill under each curve (v5); `origin: "start"` keeps a
          // scaled yAxis (wrist temp, RHR) filled from the plot bottom, not y = 0.
          areaStyle: {
            origin: "start" as const,
            opacity: 0.18,
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: panel.color(theme) },
                { offset: 1, color: "rgba(18, 22, 20, 0)" },
              ],
            },
          },
          data: seriesFor(data, panel.series),
          ...(noteAreas.length > 0 ? { markArea: { silent: true, data: noteAreas } } : {}),
        })),
      };
    },
    [data, height],
  );

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="space-y-1 pb-2">
        <h2 className="midori-kicker">{copy.pages.trends.vitalsTitle}</h2>
        <p className="text-xs text-muted-foreground">{copy.pages.trends.vitalsSubtitle}</p>
      </CardHeader>
      <CardContent>
        <EChart
          buildOption={buildOption}
          summary={summary}
          table={table}
          height={height}
          data-testid="correlated-vitals-echart"
        />
      </CardContent>
    </Card>
  );
}
