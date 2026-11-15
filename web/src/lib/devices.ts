import { METRICS } from "@midori/domain/metrics";
import type {
  EpochCardDTO,
  EpochMetricRoleDTO,
  EpochsDTO,
  OsUpdateEventDTO,
  SeamStepDTO,
} from "../api/types";
import { copy } from "../copy";
import { displayUnit, formatMetricNumber, formatShortDay } from "./finding-format";
import { DAYTIME_ORDER, OVERNIGHT_ORDER, TREND_ONLY_ORDER } from "./metrics";

export type TimelineLaneKey = "watch" | "phone" | "app";

export interface TimelineBarItem {
  shape: "bar";
  epochId: number;
  epochLabel: string;
  deviceHw: string;
  kind: EpochCardDTO["kind"];
  colorIndex: number | null;
  minor: boolean;
  startDay: string;
  endDay: string;
  dayCount: number;
  rowY: number;
  isFirstSegmentOfEpoch: boolean;
}

export interface TimelineDotsItem {
  shape: "dots";
  epochId: number;
  epochLabel: string;
  deviceHw: string;
  kind: EpochCardDTO["kind"];
  colorIndex: number | null;
  minor: boolean;
  days: string[];
  startDay: string;
  endDay: string;
  dayCount: number;
  rowY: number;
  isFirstSegmentOfEpoch: boolean;
}

export type TimelineSegmentItem = TimelineBarItem | TimelineDotsItem;

export interface TimelineOsMark {
  epochId: number;
  epochLabel: string;
  colorIndex: number | null;
  minor: boolean;
  day: string;
  fromSw: string | null;
  toSw: string;
  rowY: number;
}

export interface TimelineLane {
  key: TimelineLaneKey;
  label: string;
  rowStart: number;
  rowCount: number;
  centerY: number;
}

export interface DeviceTimelineModel {
  lanes: TimelineLane[];
  totalRows: number;
  separatorYs: number[];
  segments: TimelineSegmentItem[];
  osMarks: TimelineOsMark[];
  minDay: string | null;
  maxDay: string | null;
  legendEpochs: EpochCardDTO[];
  hasMinorEpochs: boolean;
}

export interface OrganizedEpochs {
  primaryEpochs: EpochCardDTO[];
  minorEpochs: EpochCardDTO[];
  epochById: Map<number, EpochCardDTO>;
  isSingleEpoch: boolean;
}

export interface DevicesAccessibleTable {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
}

function parseUtcDayMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1);
}

function diffDaysUtc(a: string, b: string): number {
  return Math.round((parseUtcDayMs(b) - parseUtcDayMs(a)) / 86_400_000);
}

function sortNewestFirst(a: EpochCardDTO, b: EpochCardDTO): number {
  if (a.lastDay !== b.lastDay) return a.lastDay > b.lastDay ? -1 : 1;
  if (a.firstDay !== b.firstDay) return a.firstDay > b.firstDay ? -1 : 1;
  return b.id - a.id;
}

function sortChronological(a: EpochCardDTO, b: EpochCardDTO): number {
  if (a.firstDay !== b.firstDay) return a.firstDay < b.firstDay ? -1 : 1;
  if (a.lastDay !== b.lastDay) return a.lastDay < b.lastDay ? -1 : 1;
  return a.id - b.id;
}

/**
 * Splits epochs into newest-first primary/candidate cards and collapsed occasional (minor) sources.
 */
export function organizeEpochs(dto: EpochsDTO): OrganizedEpochs {
  const epochById = new Map(dto.epochs.map((e) => [e.id, e]));
  const primaryEpochs = dto.epochs.filter((e) => !e.minor).sort(sortNewestFirst);
  const minorEpochs = dto.epochs.filter((e) => e.minor).sort(sortNewestFirst);
  const hasAnySeam = dto.epochs.some((e) => e.metrics.some((m) => m.seamFromPrevious !== null));

  return {
    primaryEpochs,
    minorEpochs,
    epochById,
    isSingleEpoch: primaryEpochs.length <= 1 && minorEpochs.length === 0 && !hasAnySeam,
  };
}

export interface RawDayRun {
  shape: "bar" | "dots";
  days: string[];
  startDay: string;
  endDay: string;
  dayCount: number;
}

/**
 * Groups `daysPresent` into contiguous wear bars (`>= 3` days separated by `<= 2` days)
 * and renders minor/sparse stretches as discrete dots (B-D3).
 */
export function buildTimelineRuns(epoch: EpochCardDTO): RawDayRun[] {
  const uniqueDays = Array.from(new Set(epoch.daysPresent.filter((d) => d.length === 10))).sort();
  if (uniqueDays.length === 0) {
    if (!epoch.firstDay) return [];
    const spanDays =
      epoch.lastDay && epoch.firstDay
        ? Math.max(1, diffDaysUtc(epoch.firstDay, epoch.lastDay) + 1)
        : 1;
    if (!epoch.minor && epoch.daysPresentCount >= 3 && spanDays >= 3) {
      return [
        {
          shape: "bar",
          days: [epoch.firstDay, epoch.lastDay || epoch.firstDay],
          startDay: epoch.firstDay,
          endDay: epoch.lastDay || epoch.firstDay,
          dayCount: epoch.daysPresentCount,
        },
      ];
    }
    return [
      {
        shape: "dots",
        days: [epoch.firstDay],
        startDay: epoch.firstDay,
        endDay: epoch.lastDay || epoch.firstDay,
        dayCount: Math.max(1, epoch.daysPresentCount),
      },
    ];
  }

  if (epoch.minor) {
    return [
      {
        shape: "dots",
        days: uniqueDays,
        startDay: uniqueDays[0] ?? epoch.firstDay,
        endDay: uniqueDays[uniqueDays.length - 1] ?? epoch.lastDay,
        dayCount: uniqueDays.length,
      },
    ];
  }

  const groups: string[][] = [];
  for (const day of uniqueDays) {
    const current = groups[groups.length - 1];
    const prev = current?.[current.length - 1];
    if (current && prev && diffDaysUtc(prev, day) <= 2) {
      current.push(day);
    } else {
      groups.push([day]);
    }
  }

  const runs: RawDayRun[] = [];
  for (const group of groups) {
    const startDay = group[0] ?? epoch.firstDay;
    const endDay = group[group.length - 1] ?? startDay;
    if (group.length >= 3) {
      runs.push({
        shape: "bar",
        days: group,
        startDay,
        endDay,
        dayCount: group.length,
      });
    } else {
      // Coalesce adjacent short runs into dots if a previous dots run exists
      const prevRun = runs[runs.length - 1];
      if (prevRun && prevRun.shape === "dots") {
        prevRun.days.push(...group);
        prevRun.endDay = endDay;
        prevRun.dayCount += group.length;
      } else {
        runs.push({
          shape: "dots",
          days: [...group],
          startDay,
          endDay,
          dayCount: group.length,
        });
      }
    }
  }
  return runs;
}

function laneForKind(kind: EpochCardDTO["kind"]): TimelineLaneKey {
  if (kind === "watch") return "watch";
  if (kind === "phone") return "phone";
  return "app";
}

/**
 * Builds lane assignments (Watch top, Phone middle, Apps bottom), non-overlapping sub-tracks,
 * bars vs dots runs, and OS update marks for the Devices timeline.
 */
export function buildDeviceTimelineModel(epochs: readonly EpochCardDTO[]): DeviceTimelineModel {
  const laneOrder: TimelineLaneKey[] = ["watch", "phone", "app"];
  const byLane = new Map<TimelineLaneKey, EpochCardDTO[]>();
  for (const key of laneOrder) byLane.set(key, []);
  for (const ep of epochs) {
    byLane.get(laneForKind(ep.kind))?.push(ep);
  }

  const activeLaneKeys = laneOrder.filter((k) => (byLane.get(k)?.length ?? 0) > 0);
  // Compute subtracks per lane
  const lanePackings = activeLaneKeys.map((key) => {
    const list = [...(byLane.get(key) ?? [])].sort(sortChronological);
    const subtrackEndDays: string[] = [];
    const assignments = list.map((ep) => {
      let assigned = subtrackEndDays.findIndex((endDay) => ep.firstDay > endDay);
      if (assigned === -1) {
        assigned = subtrackEndDays.length;
        subtrackEndDays.push(ep.lastDay);
      } else {
        subtrackEndDays[assigned] = ep.lastDay;
      }
      return { ep, subtrack: assigned };
    });
    return {
      key,
      label: copy.pages.devices.lanes[key],
      rowCount: Math.max(1, subtrackEndDays.length),
      assignments,
    };
  });

  // Assign Y bottom-to-top so the first active lane ("Watch") appears at the top of the chart.
  const totalRows = lanePackings.reduce((acc, l) => acc + l.rowCount, 0);
  const lanes: TimelineLane[] = [];
  const separatorYs: number[] = [];
  const epochRowY = new Map<number, number>();
  let cursorTop = totalRows;

  for (let i = 0; i < lanePackings.length; i += 1) {
    const lp = lanePackings[i];
    if (!lp) continue;
    const rowStart = cursorTop - lp.rowCount;
    const centerY = rowStart + (lp.rowCount - 1) / 2;
    lanes.push({
      key: lp.key,
      label: lp.label,
      rowStart,
      rowCount: lp.rowCount,
      centerY,
    });
    for (const item of lp.assignments) {
      // Subtrack 0 sits at the top of its lane
      const y = cursorTop - 1 - item.subtrack;
      epochRowY.set(item.ep.id, y);
    }
    cursorTop = rowStart;
    if (i < lanePackings.length - 1) {
      separatorYs.push(rowStart - 0.5);
    }
  }

  const segments: TimelineSegmentItem[] = [];
  const osMarks: TimelineOsMark[] = [];
  let minDay: string | null = null;
  let maxDay: string | null = null;

  const trackDay = (d: string) => {
    if (!d) return;
    if (minDay === null || d < minDay) minDay = d;
    if (maxDay === null || d > maxDay) maxDay = d;
  };

  for (const ep of [...epochs].sort(sortChronological)) {
    const rowY = epochRowY.get(ep.id) ?? 0;
    const runs = buildTimelineRuns(ep);
    runs.forEach((run, runIdx) => {
      trackDay(run.startDay);
      trackDay(run.endDay);
      if (run.shape === "bar") {
        segments.push({
          shape: "bar",
          epochId: ep.id,
          epochLabel: ep.label,
          deviceHw: ep.deviceHw,
          kind: ep.kind,
          colorIndex: ep.colorIndex,
          minor: ep.minor,
          startDay: run.startDay,
          endDay: run.endDay,
          dayCount: run.dayCount,
          rowY,
          isFirstSegmentOfEpoch: runIdx === 0,
        });
      } else {
        segments.push({
          shape: "dots",
          epochId: ep.id,
          epochLabel: ep.label,
          deviceHw: ep.deviceHw,
          kind: ep.kind,
          colorIndex: ep.colorIndex,
          minor: ep.minor,
          days: run.days,
          startDay: run.startDay,
          endDay: run.endDay,
          dayCount: run.dayCount,
          rowY,
          isFirstSegmentOfEpoch: runIdx === 0,
        });
      }
    });

    for (const os of ep.osUpdates) {
      trackDay(os.day);
      osMarks.push({
        epochId: ep.id,
        epochLabel: ep.label,
        colorIndex: ep.colorIndex,
        minor: ep.minor,
        day: os.day,
        fromSw: os.fromSw,
        toSw: os.toSw,
        rowY,
      });
    }
  }

  const legendEpochs = epochs.filter((e) => !e.minor).sort(sortChronological);
  const hasMinorEpochs = epochs.some((e) => e.minor);

  return {
    lanes,
    totalRows,
    separatorYs,
    segments,
    osMarks,
    minDay,
    maxDay,
    legendEpochs,
    hasMinorEpochs,
  };
}

const CANONICAL_METRIC_RANK = new Map<string, number>(
  [...OVERNIGHT_ORDER, ...DAYTIME_ORDER, ...TREND_ONLY_ORDER].map((m, idx) => [m, idx]),
);

export function sortEpochMetrics(metrics: readonly EpochMetricRoleDTO[]): EpochMetricRoleDTO[] {
  return [...metrics].sort((a, b) => {
    if (a.role !== b.role) {
      if (a.role === "primary") return -1;
      if (b.role === "primary") return 1;
    }
    const ra = CANONICAL_METRIC_RANK.get(a.metric) ?? 999;
    const rb = CANONICAL_METRIC_RANK.get(b.metric) ?? 999;
    if (ra !== rb) return ra - rb;
    return a.metric.localeCompare(b.metric);
  });
}

export function formatEpochSpan(
  firstDay: string,
  lastDay: string,
  asOfDay: string | null,
  daysCount: number,
): string {
  const daysText = copy.pages.devices.daysCount(daysCount);
  if (asOfDay && lastDay >= asOfDay) {
    return `${copy.pages.devices.sincePrefix(formatShortDay(firstDay))} · ${daysText}`;
  }
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4);
  const startLabel = sameYear
    ? formatShortDay(firstDay)
    : `${formatShortDay(firstDay)} ${firstDay.slice(0, 4)}`;
  const endLabel = sameYear
    ? formatShortDay(lastDay)
    : `${formatShortDay(lastDay)} ${lastDay.slice(0, 4)}`;
  return `${startLabel} – ${endLabel} · ${daysText}`;
}

export function formatBaselineLabel(row: {
  baselineState: EpochMetricRoleDTO["baselineState"] | null;
  warmup: EpochMetricRoleDTO["warmup"];
}): string {
  if (row.baselineState === null) return "—";
  const b = copy.pages.devices.baselines;
  switch (row.baselineState) {
    case "full":
      return b.full;
    case "early":
      return b.early;
    case "warming_up":
      return row.warmup ? b.learning(row.warmup.current, row.warmup.target) : b.learningGeneric;
    case "insufficient":
      return b.insufficient;
    case "trend_only":
      return b.trendOnly;
  }
}

function unitForMetric(metric: string): string {
  const spec = METRICS[metric];
  if (spec) return spec.unit;
  if (metric === "sleep_hr") return "count/min";
  return "";
}

export function formatSeamDescription(
  metric: string,
  seam: SeamStepDTO,
  fromEpochLabel?: string,
): string {
  const rawUnit = unitForMetric(metric);
  const unitLabel = displayUnit(metric, rawUnit);
  const sign = seam.value > 0 ? "+" : seam.value < 0 ? "−" : "";
  const numStr = formatMetricNumber(Math.abs(seam.value), metric, rawUnit);
  const diffText = unitLabel ? `${sign}${numStr} ${unitLabel}` : `${sign}${numStr}`;
  const base =
    seam.kind === "offset"
      ? copy.pages.devices.seamOffset(diffText, seam.nOld)
      : copy.pages.devices.seamStep(diffText);
  return fromEpochLabel ? `${base} (from ${fromEpochLabel})` : base;
}

export function formatOsUpdateLabel(ev: OsUpdateEventDTO): string {
  const dayLabel = formatShortDay(ev.day);
  return ev.fromSw ? `${ev.fromSw} → ${ev.toSw} on ${dayLabel}` : `${ev.toSw} on ${dayLabel}`;
}

export function buildDevicesSummary(epochs: readonly EpochCardDTO[]): string {
  const nonMinor = epochs.filter((e) => !e.minor).length;
  const minor = epochs.filter((e) => e.minor).length;
  return copy.pages.devices.timelineSummary(nonMinor, minor);
}

export function buildDevicesTable(epochs: readonly EpochCardDTO[]): DevicesAccessibleTable {
  const sorted = [...epochs].sort((a, b) => {
    if (a.minor !== b.minor) return a.minor ? 1 : -1;
    return sortNewestFirst(a, b);
  });

  return {
    columns: [
      { key: "label", label: "Device" },
      { key: "kind", label: "Kind" },
      { key: "span", label: "Span" },
      { key: "days", label: "Days present" },
      { key: "primaryCount", label: "Primary metrics" },
      { key: "status", label: "Status" },
    ],
    rows: sorted.map((ep) => ({
      label: ep.deviceHw ? `${ep.label} (${ep.deviceHw})` : ep.label,
      kind: copy.pages.devices.kinds[ep.kind],
      span: `${ep.firstDay} – ${ep.lastDay}`,
      days: ep.daysPresentCount,
      primaryCount: ep.primaryMetricCount,
      status: ep.minor ? copy.pages.devices.roles.minor : copy.pages.devices.roles.primary,
    })),
  };
}
