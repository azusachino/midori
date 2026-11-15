import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useMemo } from "react";
import type { MetricSeriesDTO } from "@/api/types";
import { EChart, type EChartPointClickEvent } from "@/components/EChart";
import { copy } from "@/copy";
import {
  displayUnit,
  formatDayWithWeekday,
  formatMetricNumber,
  formatShortDay,
} from "@/lib/finding-format";
import {
  buildLongViewModel,
  buildLongViewSummary,
  buildLongViewTable,
  divergingCellColor,
  formatSignedDeviation,
  type LongViewCell,
} from "@/lib/long-view";
import { formatPartialReason } from "@/lib/metric-chart";
import { type ChartTheme, epochColor } from "@/lib/theme";

export interface LongViewCalendarProps {
  series: MetricSeriesDTO;
  onSelectDay?: (day: string) => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const YEAR_BLOCK_STRIDE = 178;
const FIRST_YEAR_TOP = 38;
const YEAR_CELL_SIZE = 16;

export function LongViewCalendar({ series, onSelectDay }: LongViewCalendarProps) {
  const model = useMemo(() => buildLongViewModel(series), [series]);
  const summary = useMemo(() => buildLongViewSummary(series.metric, model), [series.metric, model]);
  const table = useMemo(() => buildLongViewTable(series, model), [series, model]);

  const handlePointClick = useCallback(
    (ev: EChartPointClickEvent) => {
      if (!onSelectDay) return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ev.name)) {
        onSelectDay(ev.name);
      }
    },
    [onSelectDay],
  );

  const height = Math.max(200, model.years.length * YEAR_BLOCK_STRIDE + 24);

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const unitLabel = displayUnit(series.metric, series.unit);
      const cellByDay = new Map<string, LongViewCell>();
      for (const yr of model.years) {
        for (const c of yr.cells) {
          cellByDay.set(c.day, c);
        }
      }
      const epochById = new Map(series.epochs.map((e) => [e.id, e]));

      const calendars = model.years.map((yr, idx) => ({
        top: FIRST_YEAR_TOP + idx * YEAR_BLOCK_STRIDE,
        left: 52,
        right: 18,
        range: yr.year,
        cellSize: ["auto", YEAR_CELL_SIZE],
        splitLine: {
          show: true,
          lineStyle: { color: theme.borderStrong, width: 1 },
        },
        itemStyle: {
          color: theme.background,
          borderColor: theme.border,
          borderWidth: 1,
        },
        yearLabel: {
          show: true,
          margin: 26,
          color: theme.foreground,
          fontSize: 12,
          fontWeight: 600,
        },
        monthLabel: {
          show: true,
          color: theme.mutedForeground,
          fontSize: 10,
          margin: 8,
        },
        dayLabel: {
          show: idx === 0,
          firstDay: 1,
          nameMap: ["S", "M", "T", "W", "T", "F", "S"],
          color: theme.mutedForeground,
          fontSize: 10,
        },
      }));

      const customSeries = model.years.map((yr, idx) => ({
        name: yr.year,
        type: "custom" as const,
        coordinateSystem: "calendar" as const,
        calendarIndex: idx,
        data: yr.cells.map((c) => ({
          name: c.day,
          value: [c.day, c.normalizedDev, c.usable ? 1 : 0, c.seam ? 1 : 0, c.colorIndex ?? 0],
        })),
        renderItem: (
          params: {
            coordSys?: { cellWidth?: number; cellHeight?: number };
          },
          api: {
            coord: (val: [number, number] | number) => [number, number];
            value: (dim: number) => number;
          },
        ) => {
          const ts = api.value(0);
          const norm = api.value(1);
          const usable = api.value(2) === 1;
          const isSeam = api.value(3) === 1;
          const colorIdx = api.value(4);

          const center = api.coord([ts, 0]);
          if (!center || Number.isNaN(center[0]) || Number.isNaN(center[1])) {
            return null;
          }

          const rawCellW = params.coordSys?.cellWidth ?? 16;
          const rawCellH = params.coordSys?.cellHeight ?? YEAR_CELL_SIZE;
          const cw = Math.max(7, Math.min(20, rawCellW - 2));
          const ch = Math.max(8, rawCellH - 2);
          const x = center[0] - cw / 2;
          const y = center[1] - ch / 2;

          const fillColor = divergingCellColor(norm);
          const epAccent = epochColor(colorIdx, theme.epochs);

          const children: Record<string, unknown>[] = [
            {
              type: "rect",
              shape: { x, y, width: cw, height: ch, r: 2 },
              style: {
                fill: fillColor,
                stroke: usable ? "rgba(24, 24, 27, 0.7)" : theme.mutedForeground,
                lineWidth: usable ? 0.5 : 1,
              },
            },
            // Subtle bottom 2px epoch ribbon to show epoch coverage inside the calendar
            {
              type: "rect",
              shape: { x: x + 0.5, y: y + ch - 2, width: Math.max(1, cw - 1), height: 2 },
              style: { fill: epAccent, opacity: 0.9 },
            },
          ];

          if (!usable) {
            // Diagonal hatch overlay across partial cells
            children.push(
              {
                type: "line",
                shape: { x1: x + 1, y1: y + ch * 0.55, x2: x + cw * 0.55, y2: y + 1 },
                style: { stroke: theme.foreground, lineWidth: 1, opacity: 0.75 },
              },
              {
                type: "line",
                shape: { x1: x + 1, y1: y + ch - 1, x2: x + cw - 1, y2: y + 1 },
                style: { stroke: theme.foreground, lineWidth: 1, opacity: 0.75 },
              },
              {
                type: "line",
                shape: { x1: x + cw * 0.45, y1: y + ch - 1, x2: x + cw - 1, y2: y + ch * 0.45 },
                style: { stroke: theme.foreground, lineWidth: 1, opacity: 0.75 },
              },
            );
          }

          if (isSeam) {
            // Seam edge marker on left boundary of seam day extending above cell top
            children.push(
              {
                type: "line",
                shape: { x1: x - 1, y1: y - 4, x2: x - 1, y2: y + ch + 3 },
                style: { stroke: theme.foreground, lineWidth: 2 },
              },
              {
                type: "polygon",
                shape: {
                  points: [
                    [x - 1, y - 5],
                    [x + 3, y - 1],
                    [x - 5, y - 1],
                  ],
                },
                style: { fill: theme.foreground },
              },
            );
          }

          return {
            type: "group",
            children,
          };
        },
      }));

      return {
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          borderWidth: 1,
          textStyle: { color: theme.foreground, fontSize: 12 },
          formatter: (raw: unknown) => {
            const p = raw as { name?: string };
            const day = p.name;
            if (!day) return "";
            const cell = cellByDay.get(day);
            if (!cell) return escapeHtml(formatDayWithWeekday(day));

            const valStr = formatMetricNumber(cell.value, series.metric, series.unit);
            const valLine = unitLabel ? `${valStr} ${unitLabel}` : valStr;
            const devLine = copy.pages.metricDetail.longView.fromStintMedian(
              formatSignedDeviation(cell.deviation, series.metric, series.unit),
            );
            const statusLine = cell.usable
              ? copy.pages.metricDetail.evidence.usableLabel
              : (formatPartialReason(cell.partialReason) ?? copy.chart.partialGeneric);

            const lines = [
              `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(formatDayWithWeekday(day))}</div>`,
              `<div>${escapeHtml(valLine)} · <span style="color:${theme.mutedForeground}">${escapeHtml(devLine)}</span></div>`,
              `<div style="color:${theme.mutedForeground};font-size:11px">${escapeHtml(cell.epochLabel)} · ${escapeHtml(statusLine)}</div>`,
            ];

            if (cell.seam) {
              const fromEp =
                epochById.get(cell.seam.fromEpochId)?.label ?? `#${cell.seam.fromEpochId}`;
              const toEp = epochById.get(cell.seam.toEpochId)?.label ?? `#${cell.seam.toEpochId}`;
              lines.push(
                `<div style="color:${theme.notable};font-size:11px;margin-top:2px">Seam (${cell.seam.kind}): ${escapeHtml(fromEp)} → ${escapeHtml(toEp)}</div>`,
              );
            }

            return lines.join("");
          },
        },
        calendar: calendars,
        series: customSeries,
      };
    },
    [model, series],
  );

  if (model.years.length === 0) {
    return (
      <div
        data-testid="long-view-empty"
        className="py-10 text-center text-sm text-muted-foreground"
      >
        {copy.pages.metricDetail.longView.noData}
      </div>
    );
  }

  const lv = copy.pages.metricDetail.longView;

  return (
    <div data-testid="long-view-panel" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          {model.activeEpochs.map((ep) => (
            <span key={ep.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: `var(--color-epoch-${((ep.colorIndex ?? 0) % 6) + 1})`,
                }}
              />
              <span className="text-foreground">{ep.label}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span>{lv.legendLower}</span>
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-16 rounded-xs"
              style={{
                background: "linear-gradient(90deg, #38bdf8 0%, #27272a 50%, #fb7185 100%)",
              }}
            />
            <span>{lv.legendHigher}</span>
            <span className="text-muted-foreground">({lv.legendMedian})</span>
          </span>

          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-xs border border-muted-foreground"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-45deg, rgba(244,244,245,0.65) 0 1px, transparent 1px 4px)",
              }}
            />
            <span>{lv.legendPartial}</span>
          </span>

          {series.seams.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-foreground" />
              <span>
                {lv.legendSeam} ({series.seams.map((s) => formatShortDay(s.seamDay)).join(", ")})
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <EChart
            data-testid="long-view-echart"
            height={height}
            buildOption={buildOption}
            onPointClick={handlePointClick}
            summary={summary}
            table={table}
          />
        </div>
      </div>
    </div>
  );
}
