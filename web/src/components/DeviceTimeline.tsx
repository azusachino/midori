import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useMemo } from "react";
import type { EpochCardDTO } from "@/api/types";
import { EChart } from "@/components/EChart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/copy";
import {
  buildDevicesSummary,
  buildDevicesTable,
  buildDeviceTimelineModel,
  type TimelineSegmentItem,
} from "@/lib/devices";
import { formatDayWithWeekday, formatShortDay } from "@/lib/finding-format";
import { type ChartTheme, epochColor } from "@/lib/theme";

interface DeviceTimelineProps {
  epochs: readonly EpochCardDTO[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseUtcDayMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1);
}

const DAY_MS = 86_400_000;

export function DeviceTimeline({ epochs }: DeviceTimelineProps) {
  const model = useMemo(() => buildDeviceTimelineModel(epochs), [epochs]);
  const summary = useMemo(() => buildDevicesSummary(epochs), [epochs]);
  const table = useMemo(() => buildDevicesTable(epochs), [epochs]);

  const height = Math.max(120, model.totalRows * 38 + 44);

  const buildOption = useCallback(
    (theme: ChartTheme, chartWidth = 800): EChartsCoreOption => {
      if (!model.minDay || !model.maxDay || model.totalRows === 0) {
        return { series: [] };
      }

      const isNarrow = chartWidth < 420;

      const rawMinTs = parseUtcDayMs(model.minDay);
      const rawMaxTs = parseUtcDayMs(model.maxDay) + DAY_MS;
      const spanMs = Math.max(7 * DAY_MS, rawMaxTs - rawMinTs);
      const padMs = Math.round(spanMs * 0.03);
      const minTs = rawMinTs - padMs;
      const maxTs = rawMaxTs + padMs;

      // Map rounded half-integer center row so multi-row lanes center their label vertically
      const labelByHalfRow = new Map<number, string>();
      for (const lane of model.lanes) {
        labelByHalfRow.set(Math.round(lane.centerY * 2), lane.label);
      }

      const segmentByIndex = new Map<number, TimelineSegmentItem>();
      const segmentData = model.segments.map((seg, idx) => {
        segmentByIndex.set(idx, seg);
        return {
          name: seg.epochLabel,
          value: [parseUtcDayMs(seg.startDay), seg.rowY, parseUtcDayMs(seg.endDay) + DAY_MS, idx],
        };
      });

      const osData = model.osMarks.map((mark, idx) => ({
        name: mark.epochLabel,
        value: [parseUtcDayMs(mark.day) + DAY_MS * 0.5, mark.rowY, idx],
      }));

      const laneDividers = model.separatorYs.map((yVal) => ({
        yAxis: yVal,
        lineStyle: { color: theme.border, width: 1, type: "solid" as const },
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
            const p = raw as { seriesIndex?: number; value?: unknown };
            const val = Array.isArray(p.value) ? p.value : [];
            if (p.seriesIndex === 1) {
              const markIdx = typeof val[2] === "number" ? val[2] : -1;
              const mark = model.osMarks[markIdx];
              if (!mark) return "";
              const verText = mark.fromSw ? `${mark.fromSw} → ${mark.toSw}` : mark.toSw;
              return [
                `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(mark.epochLabel)}</div>`,
                `<div>OS update: ${escapeHtml(verText)}</div>`,
                `<div style="color:${theme.mutedForeground};font-size:11px">${escapeHtml(formatDayWithWeekday(mark.day))}</div>`,
              ].join("");
            }

            const segIdx = typeof val[3] === "number" ? val[3] : -1;
            const seg = segmentByIndex.get(segIdx);
            if (!seg) return "";
            const meta = [
              seg.deviceHw || copy.pages.devices.kinds[seg.kind],
              seg.minor ? "minor" : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const rangeStr =
              seg.startDay === seg.endDay
                ? formatShortDay(seg.startDay)
                : `${formatShortDay(seg.startDay)} – ${formatShortDay(seg.endDay)}`;
            return [
              `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(seg.epochLabel)}</div>`,
              `<div style="color:${theme.mutedForeground};font-size:11px">${escapeHtml(meta)}</div>`,
              `<div>${escapeHtml(rangeStr)} · ${escapeHtml(copy.pages.devices.daysCount(seg.dayCount))}</div>`,
            ].join("");
          },
        },
        grid: {
          top: 12,
          right: isNarrow ? 10 : 16,
          bottom: 26,
          left: isNarrow ? 48 : 62,
        },
        xAxis: {
          type: "time",
          min: minTs,
          max: maxTs,
          axisLine: { lineStyle: { color: theme.border } },
          axisTick: { show: false },
          splitLine: { show: true, lineStyle: { color: theme.border, type: "dashed" } },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 11,
            hideOverlap: true,
          },
        },
        yAxis: {
          type: "value",
          min: -0.5,
          max: model.totalRows - 0.5,
          interval: 0.5,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: theme.mutedForeground,
            fontSize: 11,
            fontWeight: 500,
            formatter: (val: number) => labelByHalfRow.get(Math.round(val * 2)) ?? "",
          },
        },
        series: [
          {
            name: copy.pages.devices.timelineTitle,
            type: "custom",
            coordinateSystem: "cartesian2d",
            clip: true,
            data: segmentData,
            markLine:
              laneDividers.length > 0
                ? {
                    symbol: ["none", "none"],
                    silent: true,
                    label: { show: false },
                    data: laneDividers,
                  }
                : undefined,
            renderItem: (
              _params: {
                coordSys?: { x?: number; y?: number; width?: number; height?: number };
              },
              api: {
                coord: (val: [number, number]) => [number, number];
                value: (dim: number) => number;
              },
            ) => {
              const segIdx = api.value(3);
              const seg = segmentByIndex.get(segIdx);
              if (!seg) return null;

              const color = seg.minor ? theme.minor : epochColor(seg.colorIndex ?? 0, theme.epochs);
              const isWrappedEpoch = !seg.minor && (seg.colorIndex ?? 0) >= 6;

              if (seg.shape === "bar") {
                const startPt = api.coord([api.value(0), seg.rowY]);
                const endPt = api.coord([api.value(2), seg.rowY]);
                const barHeight = 20;
                const x = startPt[0];
                const y = startPt[1] - barHeight / 2;
                const width = Math.max(6, endPt[0] - startPt[0]);

                const children: Record<string, unknown>[] = [
                  {
                    type: "rect",
                    shape: { x, y, width, height: barHeight, r: 4 },
                    style: {
                      fill: color,
                      fillOpacity: 0.24,
                      stroke: color,
                      lineWidth: 1.5,
                      ...(isWrappedEpoch ? { lineDash: [4, 3] } : {}),
                    },
                  },
                ];

                if (seg.isFirstSegmentOfEpoch && width >= 68) {
                  children.push({
                    type: "text",
                    style: {
                      text: seg.epochLabel,
                      x: x + 8,
                      y: startPt[1],
                      fill: theme.foreground,
                      font: `500 11px ${theme.fontSans}`,
                      textVerticalAlign: "middle",
                      truncate: {
                        outerWidth: Math.max(12, width - 16),
                        ellipsis: "…",
                      },
                    },
                  });
                }

                return { type: "group", children };
              }

              // Sparse / minor runs render strictly as dots (B-D3)
              const children: Record<string, unknown>[] = seg.days.map((day) => {
                const pt = api.coord([parseUtcDayMs(day) + DAY_MS * 0.5, seg.rowY]);
                return {
                  type: "circle",
                  shape: { cx: pt[0], cy: pt[1], r: 3.5 },
                  style: {
                    fill: color,
                    fillOpacity: seg.minor ? 0.9 : 1,
                    stroke: theme.card,
                    lineWidth: 1,
                  },
                };
              });

              return { type: "group", children };
            },
          },
          {
            name: copy.pages.devices.legendOsUpdate,
            type: "custom",
            coordinateSystem: "cartesian2d",
            z: 6,
            data: osData,
            renderItem: (
              _params: unknown,
              api: {
                coord: (val: [number, number]) => [number, number];
                value: (dim: number) => number;
              },
            ) => {
              const markIdx = api.value(2);
              const mark = model.osMarks[markIdx];
              if (!mark) return null;
              const pt = api.coord([api.value(0), mark.rowY]);
              const cx = pt[0];
              const cy = pt[1] - 12;
              return {
                type: "polygon",
                shape: {
                  points: [
                    [cx, cy - 4],
                    [cx + 4, cy],
                    [cx, cy + 4],
                    [cx - 4, cy],
                  ],
                },
                style: {
                  fill: theme.foreground,
                  stroke: theme.card,
                  lineWidth: 1,
                },
              };
            },
          },
        ],
      };
    },
    [model],
  );

  return (
    <Card data-testid="device-timeline-card" className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="midori-kicker">{copy.pages.devices.timelineTitle}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {model.legendEpochs.map((ep) => {
            const cIdx = ep.colorIndex ?? 0;
            return (
              <span key={ep.id} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: `var(--color-epoch-${(cIdx % 6) + 1})`,
                  }}
                />
                <span className="text-foreground">{ep.label}</span>
              </span>
            );
          })}
          {model.hasMinorEpochs ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-minor" />
              <span>{copy.pages.devices.legendSparseDot}</span>
            </span>
          ) : null}
          {model.osMarks.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 bg-foreground" />
              <span>{copy.pages.devices.legendOsUpdate}</span>
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        <div className="w-full min-w-0">
          <EChart
            data-testid="device-timeline-echart"
            height={height}
            buildOption={buildOption}
            summary={summary}
            table={table}
          />
        </div>
      </CardContent>
    </Card>
  );
}
