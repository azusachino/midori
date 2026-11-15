import type { MetricIndexEntryDTO, WeeklySeriesPointDTO } from "../api/types";
import { copy } from "../copy";
import { displayUnit, formatMetricNumber, formatShortDay } from "./finding-format";
import type { ChartAccessibleTable } from "./long-view";

export interface EpochWeeklySeriesSegment {
  epochId: number;
  colorIndex: number;
  points: Array<{
    weekStart: string;
    median: number | null;
    hasPartial: boolean;
  }>;
}

/** Resolves the app-wide palette slot for each epoch ID (preferring server `colorIndex`). */
export function miniChartColorIndexMap(
  weeklySeries: readonly WeeklySeriesPointDTO[],
  epochColorIndices?: ReadonlyMap<number, number | null>,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const pt of weeklySeries) {
    if (pt.epochId !== null && !map.has(pt.epochId)) {
      const serverIndex = epochColorIndices?.get(pt.epochId);
      map.set(
        pt.epochId,
        typeof serverIndex === "number" ? serverIndex : Math.max(0, pt.epochId - 1) % 6,
      );
    }
  }
  return map;
}

/** Splits weekly series by epochId with nulls elsewhere so lines never bridge a seam. */
export function buildEpochWeeklySegments(
  weeklySeries: readonly WeeklySeriesPointDTO[],
  epochColorIndices?: ReadonlyMap<number, number | null>,
): EpochWeeklySeriesSegment[] {
  const colorMap = miniChartColorIndexMap(weeklySeries, epochColorIndices);
  const epochIds = Array.from(colorMap.keys());

  return epochIds.map((epochId) => ({
    epochId,
    colorIndex: colorMap.get(epochId) ?? 0,
    points: weeklySeries.map((pt) => ({
      weekStart: pt.weekStart,
      median: pt.epochId === epochId ? pt.median : null,
      hasPartial: pt.epochId === epochId && pt.hasPartial,
    })),
  }));
}

/** Resolves each seam day onto the matching week bucket so dashed seam lines align cleanly. */
export function resolveWeeklySeamWeek(
  weeklySeries: readonly WeeklySeriesPointDTO[],
  seamDay: string,
): string | null {
  if (weeklySeries.length === 0) return null;
  let candidate: string | null = null;
  for (const pt of weeklySeries) {
    if (pt.weekStart <= seamDay) {
      candidate = pt.weekStart;
    } else {
      break;
    }
  }
  return candidate ?? weeklySeries[0]?.weekStart ?? null;
}

export function buildMiniChartSummary(entry: MetricIndexEntryDTO): string {
  const label = copy.metrics[entry.metric] ?? entry.metric;
  if (!entry.hasData || entry.weeklySeries.length === 0) {
    return `${label}: ${copy.pages.metrics.noDataYet}`;
  }
  return copy.pages.metrics.weeklySummary(label, entry.weeklySeries.length, entry.seams.length);
}

export function buildMiniChartTable(
  entry: MetricIndexEntryDTO,
  epochLabels?: ReadonlyMap<number, string>,
): ChartAccessibleTable {
  const unitLabel = displayUnit(entry.metric, entry.unit);
  const seamWeekByDay = new Map<string, string>();
  for (const s of entry.seams) {
    const wk = resolveWeeklySeamWeek(entry.weeklySeries, s.day);
    if (wk) seamWeekByDay.set(wk, `${s.kind} (${formatShortDay(s.day)})`);
  }

  return {
    columns: [
      { key: "weekStart", label: copy.chart.dayCol },
      { key: "median", label: copy.chart.valueCol },
      { key: "epochId", label: copy.chart.epochCol },
      { key: "seam", label: copy.pages.metricDetail.longView.colSeam },
    ],
    rows: entry.weeklySeries.map((pt) => {
      const epochLabel =
        pt.epochId === null
          ? "—"
          : (epochLabels?.get(pt.epochId) ??
            (entry.finding?.epochId === pt.epochId ? entry.finding.epochLabel : null) ??
            `Epoch ${pt.epochId}`);
      return {
        weekStart: pt.weekStart,
        median:
          pt.median === null
            ? "—"
            : unitLabel
              ? `${formatMetricNumber(pt.median, entry.metric, entry.unit)} ${unitLabel}`
              : formatMetricNumber(pt.median, entry.metric, entry.unit),
        epochId: epochLabel,
        seam: seamWeekByDay.get(pt.weekStart) ?? "—",
      };
    }),
  };
}
