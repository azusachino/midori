import type { EChartsCoreOption } from "echarts/core";
import { graphic } from "echarts/core";
import { useCallback, useMemo } from "react";
import type { MetricSeriesDTO, MetricUnitPointDTO } from "@/api/types";
import { EChart, type EChartPointClickEvent, type EChartZoomEvent } from "@/components/EChart";
import { copy } from "@/copy";
import { displayUnit, formatDayWithWeekday, formatMetricNumber } from "@/lib/finding-format";
import {
  buildBandPolygons,
  buildCalendarDays,
  buildMetricChartSummary,
  buildMetricChartTable,
  currentStintBandPoints,
  findRecentWindow,
  formatPartialReason,
  formatSeamLabel,
  resolveZoomWindow,
  shouldIncludeZero,
  toWeekStartMonday,
  zoomEventToDays,
} from "@/lib/metric-chart";
import { type ChartTheme, epochColor } from "@/lib/theme";

export interface MetricChartProps {
  series: MetricSeriesDTO;
  zoomStart?: string | undefined;
  zoomEnd?: string | undefined;
  onZoomChange?: (zoom: { zoomStart: string; zoomEnd: string } | null) => void;
  onSelectDay?: (day: string) => void;
  height?: number;
}

interface TooltipSeriesParam {
  seriesName?: string;
  dataIndex?: number;
  value?: number | null | { value?: number | null };
  color?: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nearestValueForEpoch(
  units: readonly MetricUnitPointDTO[],
  epochId: number,
  targetDay: string,
): number | null {
  const exact = units.find((u) => u.epochId === epochId && u.day === targetDay && u.value !== null);
  if (exact && exact.value !== null) return exact.value;

  const epochVals = units.filter((u) => u.epochId === epochId && u.value !== null);
  if (epochVals.length === 0) return null;
  let best = epochVals[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  const targetMs = Date.parse(`${targetDay}T00:00:00Z`);
  for (const pt of epochVals) {
    const diff = Math.abs(Date.parse(`${pt.day}T00:00:00Z`) - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pt;
    }
  }
  return best?.value ?? null;
}

export function MetricChart({
  series,
  zoomStart,
  zoomEnd,
  onZoomChange,
  onSelectDay,
  height = 320,
}: MetricChartProps) {
  const days = useMemo(() => buildCalendarDays(series), [series]);
  const dayIndex = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((d, idx) => {
      map.set(d, idx);
    });
    return map;
  }, [days]);

  const currentBand = useMemo(() => currentStintBandPoints(series), [series]);
  const bandSegments = useMemo(
    () => buildBandPolygons(currentBand, dayIndex),
    [currentBand, dayIndex],
  );
  const recentWindow = useMemo(() => findRecentWindow(series.units), [series.units]);
  const summary = useMemo(() => buildMetricChartSummary(series), [series]);
  const table = useMemo(() => buildMetricChartTable(series), [series]);
  const zoomWindow = useMemo(
    () => resolveZoomWindow(days, zoomStart, zoomEnd),
    [days, zoomStart, zoomEnd],
  );

  const handleDataZoom = useCallback(
    (ev: EChartZoomEvent) => {
      if (!onZoomChange) return;
      onZoomChange(zoomEventToDays(days, ev));
    },
    [days, onZoomChange],
  );

  const handlePointClick = useCallback(
    (ev: EChartPointClickEvent) => {
      if (!onSelectDay) return;
      if (ev.seriesType !== "line" && ev.seriesType !== "scatter" && ev.seriesType !== "grid") {
        return;
      }
      const day = days[ev.dataIndex] ?? (/^\d{4}-\d{2}-\d{2}$/.test(ev.name) ? ev.name : undefined);
      if (day) onSelectDay(day);
    },
    [days, onSelectDay],
  );

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const unitLabel = displayUnit(series.metric, series.unit);
      const nonMinorEpochs = series.epochs.filter((e) => !e.minor);
      const minorEpochs = series.epochs.filter((e) => e.minor);
      const isWeekly = series.range === "all";
      const axisDay = (d: string) => (isWeekly ? toWeekStartMonday(d) : d);
      const epochById = new Map(series.epochs.map((e) => [e.id, e]));

      const unitByEpochDay = new Map<string, MetricUnitPointDTO>();
      for (const u of series.units) {
        unitByEpochDay.set(`${u.epochId}:${u.day}`, u);
      }
      const bandByDay = new Map(currentBand.map((b) => [b.day, b]));
      const seamsByDay = new Map(series.seams.map((s) => [axisDay(s.seamDay), s]));
      const osUpdatesByDay = new Map(series.osUpdates.map((u) => [axisDay(u.day), u]));

      const echartsSeries: Record<string, unknown>[] = [];

      // 1. Custom polygon baseline band (works across negative, zero-crossing, or positive bounds)
      if (bandSegments.length > 0) {
        const renderBandPolygon = (
          params: { coordSys: unknown },
          api: {
            value: (idx: number) => number | string;
            coord: (val: [number, number]) => number[];
          },
        ) => {
          const segIdx = Number(api.value(0));
          const seg = bandSegments[segIdx];
          if (!seg || seg.points.length === 0) return null;

          const top: number[][] = [];
          const bottom: number[][] = [];
          for (const pt of seg.points) {
            top.push(api.coord([pt.xIndex, pt.high]));
            bottom.push(api.coord([pt.xIndex, pt.low]));
          }
          const rawPolygon = [...top, ...bottom.reverse()];
          const coordSys = params.coordSys as {
            x: number;
            y: number;
            width: number;
            height: number;
          };
          const clipped = graphic.clipPointsByRect(rawPolygon, coordSys);
          if (clipped.length < 3) return null;

          return {
            type: "polygon" as const,
            shape: { points: clipped },
            style: {
              fill: "rgba(161, 161, 170, 0.16)",
              stroke: "rgba(161, 161, 170, 0.30)",
              lineWidth: 1,
            },
          };
        };

        echartsSeries.push({
          name: copy.chart.baselineBandLabel,
          type: "custom",
          silent: true,
          z: 1,
          renderItem: renderBandPolygon,
          encode: { x: [1, 2], y: [3, 4] },
          data: bandSegments.map((seg, idx) => [idx, seg.minX, seg.maxX, seg.minLow, seg.maxHigh]),
        });

        // Faint dashed baseline median line
        const medianData = days.map((day) => {
          const pt = bandByDay.get(day);
          return pt ? pt.median : null;
        });
        echartsSeries.push({
          name: copy.chart.baselineMedianLabel,
          type: "line",
          silent: true,
          z: 2,
          showSymbol: false,
          connectNulls: false,
          lineStyle: {
            color: theme.mutedForeground,
            width: 1,
            type: "dashed",
            opacity: 0.55,
          },
          data: medianData,
        });
      }

      // 2. Non-minor primary epoch series (each gets a distinct categorical palette color)
      nonMinorEpochs.forEach((epoch, idx) => {
        const color = epochColor(epoch.colorIndex ?? idx, theme.epochs);
        const pointData = days.map((day) => {
          const u = unitByEpochDay.get(`${epoch.id}:${day}`);
          if (!u || u.value === null) return null;
          if (!u.usable) {
            return {
              value: u.value,
              symbol: "emptyCircle",
              symbolSize: 8,
              itemStyle: {
                color: theme.card,
                borderColor: color,
                borderWidth: 2,
              },
            };
          }
          return {
            value: u.value,
            symbol: "circle",
            symbolSize: 4,
            itemStyle: { color },
          };
        });

        const osUpdatesForEpoch = series.osUpdates
          .filter((u) => u.epochId === epoch.id)
          .flatMap((u) => {
            const coordDay = axisDay(u.day);
            const val = nearestValueForEpoch(series.units, epoch.id, coordDay);
            if (val === null || !dayIndex.has(coordDay)) return [];
            const swText = u.fromSw ? `${u.fromSw} → ${u.toSw}` : u.toSw;
            return [
              {
                name: `${copy.chart.osUpdateLabel} ${swText}`,
                coord: [coordDay, val],
                value: `OS ${u.toSw}`,
              },
            ];
          });

        const attachSharedAnnotations = idx === 0;
        const seamLines = attachSharedAnnotations
          ? series.seams.flatMap((seam) => {
              const seamDay = axisDay(seam.seamDay);
              if (!dayIndex.has(seamDay)) return [];
              return [
                {
                  xAxis: seamDay,
                  lineStyle: {
                    color: theme.borderStrong,
                    type: "dashed" as const,
                    width: 1.25,
                  },
                  label: {
                    show: true,
                    rotate: 0,
                    align: "right" as const,
                    verticalAlign: "top" as const,
                    distance: 8,
                    formatter: formatSeamLabel(seam, series.epochs, series.metric, series.unit),
                    color: theme.foreground,
                    backgroundColor: theme.card,
                    borderColor: theme.borderStrong,
                    borderWidth: 1,
                    borderRadius: 4,
                    padding: [3, 6],
                    fontSize: 11,
                    position: "insideEndTop" as const,
                  },
                },
              ];
            })
          : [];

        const recentArea =
          attachSharedAnnotations && recentWindow
            ? [
                [
                  {
                    name: copy.chart.recentWindowLabel,
                    xAxis: recentWindow.startDay,
                    itemStyle: { color: "rgba(161, 161, 170, 0.08)" },
                    label: {
                      show: true,
                      position: "insideTopLeft" as const,
                      color: theme.mutedForeground,
                      fontSize: 11,
                    },
                  },
                  { xAxis: recentWindow.endDay },
                ],
              ]
            : undefined;

        echartsSeries.push({
          name: epoch.label,
          type: "line",
          z: 4,
          connectNulls: false,
          showAllSymbol: true,
          lineStyle: { color, width: 1.75 },
          itemStyle: { color },
          data: pointData,
          ...(seamLines.length > 0
            ? {
                markLine: {
                  symbol: ["none", "none"],
                  silent: true,
                  data: seamLines,
                },
              }
            : {}),
          ...(recentArea ? { markArea: { silent: true, data: recentArea } } : {}),
          ...(osUpdatesForEpoch.length > 0
            ? {
                markPoint: {
                  symbol: "diamond",
                  symbolSize: 12,
                  itemStyle: {
                    color: theme.card,
                    borderColor: color,
                    borderWidth: 1.5,
                  },
                  label: {
                    show: true,
                    position: "top",
                    formatter: (p: { value?: string }) => String(p.value ?? ""),
                    color: theme.mutedForeground,
                    fontSize: 10,
                    backgroundColor: theme.card,
                    padding: [1, 4],
                    borderRadius: 3,
                  },
                  data: osUpdatesForEpoch,
                },
              }
            : {}),
        });
      });

      // 3. Minor epochs rendered as 40%-opacity neutral points (no palette slot, hidden from legend)
      minorEpochs.forEach((epoch) => {
        const scatterData = days.map((day) => {
          const u = unitByEpochDay.get(`${epoch.id}:${day}`);
          return u && u.value !== null ? u.value : null;
        });

        echartsSeries.push({
          name: epoch.label,
          type: "scatter",
          z: 3,
          symbolSize: 6,
          itemStyle: {
            color: theme.minor,
            opacity: 0.4,
          },
          data: scatterData,
        });
      });

      const zoomOptionBase = {
        filterMode: "none" as const,
        ...(zoomWindow ? zoomWindow : {}),
      };

      return {
        legend: {
          top: 2,
          left: 0,
          data: nonMinorEpochs.map((e) => e.label),
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          itemGap: 14,
          textStyle: {
            color: theme.mutedForeground,
            fontSize: 12,
          },
        },
        grid: {
          left: 52,
          right: 20,
          top: 58,
          bottom: 58,
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.foreground, fontSize: 12 },
          formatter: (rawParams: unknown) => {
            const list = Array.isArray(rawParams) ? (rawParams as TooltipSeriesParam[]) : [];
            const firstIdx = list[0]?.dataIndex;
            const day = typeof firstIdx === "number" ? days[firstIdx] : undefined;
            if (!day) return "";

            const lines: string[] = [
              `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(formatDayWithWeekday(day))}</div>`,
            ];

            for (const epoch of series.epochs) {
              const u = unitByEpochDay.get(`${epoch.id}:${day}`);
              if (!u || u.value === null) continue;
              const formatted = formatMetricNumber(u.value, series.metric, series.unit);
              const valWithUnit = unitLabel ? `${formatted} ${unitLabel}` : formatted;
              const dotColor = epoch.minor
                ? theme.minor
                : epochColor(
                    epoch.colorIndex ??
                      Math.max(
                        0,
                        nonMinorEpochs.findIndex((e) => e.id === epoch.id),
                      ),
                    theme.epochs,
                  );
              const notes: string[] = [];
              if (!u.usable) {
                notes.push(formatPartialReason(u.partialReason) ?? copy.chart.partialGeneric);
              }
              if (u.tzChange) notes.push(copy.chart.tzShiftNote);
              if (epoch.minor) notes.push(copy.chart.minorEpochNote);
              if (u.n > 0) notes.push(`n=${u.n}`);
              const suffix = notes.length > 0 ? ` · ${escapeHtml(notes.join(", "))}` : "";
              const resolvedEpoch = epochById.get(epoch.id) ?? epoch;
              lines.push(
                `<div><span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background:${dotColor};margin-right:6px;"></span>${escapeHtml(resolvedEpoch.label)}: <strong>${escapeHtml(valWithUnit)}</strong><span style="color:${theme.mutedForeground};">${suffix}</span></div>`,
              );
            }

            const bandPt = bandByDay.get(day);
            if (bandPt) {
              const med = formatMetricNumber(bandPt.median, series.metric, series.unit);
              const lo = formatMetricNumber(bandPt.low, series.metric, series.unit);
              const hi = formatMetricNumber(bandPt.high, series.metric, series.unit);
              lines.push(
                `<div style="color:${theme.mutedForeground};margin-top:3px;">${escapeHtml(copy.chart.baselineBandLabel)}: ${escapeHtml(lo)}–${escapeHtml(hi)} (median ${escapeHtml(med)})</div>`,
              );
            }

            const seam = seamsByDay.get(day);
            if (seam) {
              lines.push(
                `<div style="color:${theme.notable};margin-top:3px;">${escapeHtml(formatSeamLabel(seam, series.epochs, series.metric, series.unit))}</div>`,
              );
            }

            const osUpd = osUpdatesByDay.get(day);
            if (osUpd) {
              const swText = osUpd.fromSw ? `${osUpd.fromSw} → ${osUpd.toSw}` : osUpd.toSw;
              lines.push(
                `<div style="color:${theme.learning};margin-top:3px;">${escapeHtml(copy.chart.osUpdateLabel)}: ${escapeHtml(swText)}</div>`,
              );
            }

            return lines.join("");
          },
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: days,
          axisLine: { lineStyle: { color: theme.borderStrong } },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 11,
            formatter: (val: string) => {
              const parts = val.split("-");
              if (parts.length !== 3) return val;
              const months = [
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
              ];
              const m = months[Number(parts[1]) - 1] ?? parts[1];
              return `${m} ${Number(parts[2])}`;
            },
          },
        },
        yAxis: {
          type: "value",
          name: unitLabel,
          nameTextStyle: { color: theme.mutedForeground, fontSize: 11 },
          scale: !shouldIncludeZero(series.metric),
          min: shouldIncludeZero(series.metric) ? 0 : undefined,
          splitLine: { lineStyle: { color: theme.border } },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 11,
            formatter: (val: number) => formatMetricNumber(val, series.metric, series.unit),
          },
        },
        dataZoom: [
          {
            type: "slider",
            xAxisIndex: 0,
            left: 52,
            right: 20,
            height: 22,
            bottom: 6,
            brushSelect: false,
            showDetail: false,
            realtime: false,
            borderColor: theme.borderStrong,
            backgroundColor: theme.background,
            fillerColor: "rgba(52, 211, 153, 0.12)",
            handleStyle: { color: theme.mutedForeground, borderColor: theme.borderStrong },
            dataBackground: {
              lineStyle: { color: theme.borderStrong },
              areaStyle: { color: theme.border },
            },
            selectedDataBackground: {
              lineStyle: { color: theme.accent },
              areaStyle: { color: "rgba(52, 211, 153, 0.16)" },
            },
            textStyle: { color: theme.mutedForeground, fontSize: 10 },
            ...zoomOptionBase,
          },
          {
            type: "inside",
            xAxisIndex: 0,
            ...zoomOptionBase,
          },
        ],
        series: echartsSeries,
      };
    },
    [bandSegments, currentBand, dayIndex, days, recentWindow, series, zoomWindow],
  );

  return (
    <EChart
      data-testid="metric-echart"
      height={height}
      buildOption={buildOption}
      onDataZoom={handleDataZoom}
      onPointClick={handlePointClick}
      summary={summary}
      table={table}
    />
  );
}
