import type { EChartsCoreOption } from "echarts/core";
import { graphic } from "echarts/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { apiClient } from "@/api/client";
import type {
  MetricSeriesDTO,
  MetricUnitPointDTO,
  OsUpdateEventDTO,
  SeamStepDTO,
} from "@/api/types";
import { EChart, type EChartPointClickEvent, type EChartZoomEvent } from "@/components/EChart";
import { copy } from "@/copy";
import { displayUnit, formatDayWithWeekday, formatMetricNumber } from "@/lib/finding-format";
import {
  buildBandPolygons,
  buildCalendarDays,
  buildMetricChartSummary,
  buildMetricChartTable,
  currentStintBandPoints,
  estimateLegendRows,
  findRecentWindow,
  formatPartialReason,
  formatSeamLabel,
  resolveSeamLabelLayouts,
  resolveZoomWindow,
  selectPrimaryOsUpdatesInView,
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

  const zoneByDayRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (series.range === "all" || days.length === 0) {
      zoneByDayRef.current = new Map();
      return;
    }
    const toDay = days[days.length - 1];
    const firstDay = days[0];
    if (!toDay || !firstDay) return;
    // /api/nights caps spans at 400 days (inclusive of endpoints -> max 399 day delta).
    const toMs = Date.parse(`${toDay}T00:00:00Z`);
    const firstMs = Date.parse(`${firstDay}T00:00:00Z`);
    const minFromMs = toMs - 399 * 86_400_000;
    const fromDay = new Date(Math.max(firstMs, minFromMs)).toISOString().slice(0, 10);

    const controller = new AbortController();
    apiClient
      .nights(fromDay, toDay, controller.signal)
      .then((dto) => {
        if (controller.signal.aborted) return;
        const map = new Map<string, string>();
        for (const night of dto.nights) {
          if (night.zone) map.set(night.date, night.zone);
        }
        zoneByDayRef.current = map;
      })
      .catch(() => {
        // Tooltip degrades gracefully without zone when /api/nights fails or aborts.
      });
    return () => controller.abort();
  }, [days, series.range]);

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
    (theme: ChartTheme, chartWidth = 880): EChartsCoreOption => {
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
      const gridWidth = Math.max(160, chartWidth - 72);
      const bandByDay = new Map(currentBand.map((b) => [b.day, b]));
      const seamLayouts = resolveSeamLabelLayouts(
        series.seams,
        series.epochs,
        days,
        series.metric,
        series.unit,
        {
          isWeekly,
          gridWidth,
          viewStartIdx: zoomWindow?.startValue,
          viewEndIdx: zoomWindow?.endValue,
        },
      );
      const seamOverlapsTopRight = seamLayouts.some(
        (layout) => layout.showLabel && layout.spanEnd >= gridWidth - 54,
      );
      const seamsByDay = new Map<string, SeamStepDTO[]>();
      for (const s of series.seams) {
        const keyDay = axisDay(s.seamDay);
        const list = seamsByDay.get(keyDay);
        if (list) list.push(s);
        else seamsByDay.set(keyDay, [s]);
      }
      const hiddenSeamXIndices = Array.from(
        new Set(seamLayouts.filter((s) => !s.showLabel).map((s) => s.seamIdx)),
      ).sort((a, b) => a - b);
      const primaryOsUpdates = selectPrimaryOsUpdatesInView(series, days);
      const osUpdatesByDay = new Map<string, OsUpdateEventDTO[]>();
      const osUpdateXSet = new Set<number>();
      for (const upd of primaryOsUpdates) {
        const coordDay = axisDay(upd.day);
        const xIdx = dayIndex.get(coordDay);
        if (xIdx === undefined) continue;
        osUpdateXSet.add(xIdx);
        const list = osUpdatesByDay.get(coordDay);
        if (list) {
          list.push(upd);
        } else {
          osUpdatesByDay.set(coordDay, [upd]);
        }
      }
      const osUpdateXIndices = Array.from(osUpdateXSet).sort((a, b) => a - b);

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

        const attachSharedAnnotations = idx === 0;
        const seamLines = attachSharedAnnotations
          ? seamLayouts.map((layout) => ({
              xAxis: layout.seamDay,
              lineStyle: {
                color: theme.borderStrong,
                type: "dashed" as const,
                width: 1.25,
              },
              label: layout.showLabel
                ? {
                    show: true,
                    rotate: 0,
                    align: layout.align,
                    verticalAlign: "top" as const,
                    distance: 6,
                    formatter: layout.displayLabel,
                    color: theme.foreground,
                    backgroundColor: theme.card,
                    borderColor: theme.borderStrong,
                    borderWidth: 1,
                    borderRadius: 4,
                    padding: [3, 6],
                    fontSize: 11,
                    position: "insideEndTop" as const,
                  }
                : { show: false },
            }))
          : [];

        const recentStart = recentWindow ? axisDay(recentWindow.startDay) : null;
        const recentEnd = recentWindow ? axisDay(recentWindow.endDay) : null;
        const recentArea =
          attachSharedAnnotations &&
          recentStart !== null &&
          recentEnd !== null &&
          dayIndex.has(recentStart) &&
          dayIndex.has(recentEnd)
            ? [
                [
                  {
                    name: copy.chart.recentWindowLabel,
                    xAxis: recentStart,
                    itemStyle: { color: "rgba(161, 161, 170, 0.08)" },
                    label: {
                      show: true,
                      position: seamOverlapsTopRight
                        ? ("insideBottomRight" as const)
                        : ("insideTopRight" as const),
                      color: theme.mutedForeground,
                      fontSize: 11,
                    },
                  },
                  { xAxis: recentEnd },
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

      // 4. Primary-epoch OS update ticks along the x-axis baseline (no chart labels; tooltip only)
      if (osUpdateXIndices.length > 0) {
        echartsSeries.push({
          name: copy.chart.osUpdateLabel,
          type: "custom",
          silent: true,
          z: 5,
          encode: { x: 0 },
          renderItem: (
            params: { coordSys: unknown },
            api: {
              value: (idx: number) => number | string;
              coord: (val: [number, number]) => number[];
            },
          ) => {
            const xIdx = Number(api.value(0));
            const pt = api.coord([xIdx, 0]);
            const coordSys = params.coordSys as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            const xPx = pt[0] ?? 0;
            if (xPx < coordSys.x || xPx > coordSys.x + coordSys.width) return null;
            const baselineY = coordSys.y + coordSys.height;
            return {
              type: "polygon" as const,
              shape: {
                points: [
                  [xPx, baselineY - 7],
                  [xPx - 4, baselineY],
                  [xPx + 4, baselineY],
                ],
              },
              style: {
                fill: theme.learning,
                stroke: theme.card,
                lineWidth: 0.75,
              },
            };
          },
          data: osUpdateXIndices.map((xIdx) => [xIdx]),
        });
      }

      // 5. Top diamond markers for seams whose text label was suppressed to prevent overlap
      if (hiddenSeamXIndices.length > 0) {
        echartsSeries.push({
          name: "Device seam",
          type: "custom",
          silent: true,
          z: 5,
          encode: { x: 0 },
          renderItem: (
            params: { coordSys: unknown },
            api: {
              value: (idx: number) => number | string;
              coord: (val: [number, number]) => number[];
            },
          ) => {
            const xIdx = Number(api.value(0));
            const pt = api.coord([xIdx, 0]);
            const coordSys = params.coordSys as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            const xPx = pt[0] ?? 0;
            if (xPx < coordSys.x || xPx > coordSys.x + coordSys.width) return null;
            const topY = coordSys.y + 6;
            return {
              type: "polygon" as const,
              shape: {
                points: [
                  [xPx, topY - 4.5],
                  [xPx + 4.5, topY],
                  [xPx, topY + 4.5],
                  [xPx - 4.5, topY],
                ],
              },
              style: {
                fill: theme.notable,
                stroke: theme.card,
                lineWidth: 0.75,
              },
            };
          },
          data: hiddenSeamXIndices.map((xIdx) => [xIdx]),
        });
      }

      const zoomOptionBase = {
        filterMode: "none" as const,
        ...(zoomWindow ? zoomWindow : {}),
      };

      const legendLabels = nonMinorEpochs.map((e) => e.label);
      const legendRows = estimateLegendRows(legendLabels, chartWidth);
      const legendHeight = legendRows > 0 ? 8 + legendRows * 22 : 12;
      const gridTop = Math.max(58, legendHeight + (unitLabel ? 22 : 8));

      return {
        legend: {
          top: 2,
          left: 0,
          width: Math.max(120, chartWidth - 8),
          data: legendLabels,
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
          top: gridTop,
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

            const zone = series.range !== "all" ? zoneByDayRef.current.get(day) : undefined;
            const lines: string[] = [
              `<div style="font-weight:600;margin-bottom:4px;">${escapeHtml(formatDayWithWeekday(day))}${zone ? ` <span style="font-weight:400;color:${theme.mutedForeground};">· ${escapeHtml(zone)}</span>` : ""}</div>`,
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
              const notes: string[] = [
                u.usable
                  ? copy.pages.metricDetail.evidence.usableLabel
                  : (formatPartialReason(u.partialReason) ?? copy.chart.partialGeneric),
              ];
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

            const seamsForDay = seamsByDay.get(day);
            if (seamsForDay && seamsForDay.length > 0) {
              for (const seam of seamsForDay) {
                lines.push(
                  `<div style="color:${theme.notable};margin-top:3px;">${escapeHtml(formatSeamLabel(seam, series.epochs, series.metric, series.unit))}</div>`,
                );
              }
            }

            const osUpdatesForDay = osUpdatesByDay.get(day);
            if (osUpdatesForDay && osUpdatesForDay.length > 0) {
              for (const osUpd of osUpdatesForDay) {
                const swText = osUpd.fromSw ? `${osUpd.fromSw} → ${osUpd.toSw}` : osUpd.toSw;
                lines.push(
                  `<div style="color:${theme.learning};margin-top:3px;">${escapeHtml(copy.chart.osUpdateLabel)}: ${escapeHtml(swText)}</div>`,
                );
              }
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
