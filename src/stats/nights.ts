import type { Database } from "bun:sqlite";
import {
  addDays,
  instantInZone,
  parseHealthKitDate,
  utcToLocal,
  zoneLocalToUtc,
} from "../domain/dates";
import { METRICS, type MetricSpec } from "../domain/metrics";
import { type PersistedEpochDerivation, rebuildEpochs } from "./epochs";
import { deriveStints, type MetricUnit, type Stint } from "./stints";

export type SleepStage =
  | "inBed"
  | "asleepCore"
  | "asleepDeep"
  | "asleepREM"
  | "asleepUnspecified"
  | "awake";

export const SLEEP_STAGES: readonly SleepStage[] = [
  "inBed",
  "asleepCore",
  "asleepDeep",
  "asleepREM",
  "asleepUnspecified",
  "awake",
];

export interface SleepRecordInput {
  source: string;
  stage: SleepStage;
  startUtcIso: string;
  endUtcIso: string;
  startLocalDay: string;
  startLocalMinute: number;
}

export interface Night {
  date: string;
  dominantSource: string;
  stageSeconds: Record<SleepStage, number>;
  sourceSeconds: Record<string, number>;
  sourceRecordCounts: Record<string, number>;
}

export interface DerivedNight {
  date: string;
  zone: string;
  tzChange: number;
  partialReason: string | null;
  asleepS: number;
  coreS: number;
  deepS: number;
  remS: number;
  inBedS: number;
}

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";
const NIGHT_START_MINUTE = 15 * 60;
const NIGHT_END_MINUTE = 9 * 60;
const CONTINUATION_END_MINUTE = 12 * 60;
const CONTINUATION_TOLERANCE_MS = 60 * 60_000;
const ASLEEP = new Set<SleepStage>(["asleepCore", "asleepDeep", "asleepREM", "asleepUnspecified"]);
const SLEEP_VALUE_STAGE: Readonly<Record<string, SleepStage>> = {
  HKCategoryValueSleepAnalysisInBed: "inBed",
  HKCategoryValueSleepAnalysisAsleepCore: "asleepCore",
  HKCategoryValueSleepAnalysisAsleepDeep: "asleepDeep",
  HKCategoryValueSleepAnalysisAsleepREM: "asleepREM",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleepUnspecified",
  HKCategoryValueSleepAnalysisAwake: "awake",
};
const METRIC_BY_TYPE = new Map<string, MetricSpec>();
for (const spec of Object.values(METRICS)) {
  for (const type of spec.types) METRIC_BY_TYPE.set(type, spec);
}
const validZoneCache = new Map<string, boolean>();
const parsedZoneCache = new Map<string, string | null>();

export function nightKeyForSleepRecord(day: string, minute: number): string | null {
  if (minute >= NIGHT_START_MINUTE) return day;
  if (minute < NIGHT_END_MINUTE) return addDays(day, -1);
  return null;
}

export function inHrvNightWindow(minute: number): boolean {
  return minute >= 21 * 60 || minute < NIGHT_END_MINUTE;
}

export function continuesNight(startAt: string, lastAsleepEndAt: string | null): boolean {
  return (
    lastAsleepEndAt !== null &&
    Date.parse(startAt) >= Date.parse(lastAsleepEndAt) &&
    Date.parse(startAt) - Date.parse(lastAsleepEndAt) <= CONTINUATION_TOLERANCE_MS
  );
}

export function exportCutReason(
  nightDate: string,
  zone: string,
  exportAt: string | null,
): string | null {
  return exportAt !== null &&
    zoneLocalToUtc(addDays(nightDate, 1), 12 * 60, zone) > Date.parse(exportAt)
    ? "export_cut"
    : null;
}

function durationSeconds(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs) / 1000;
}

function emptyStageSeconds(): Record<SleepStage, number> {
  return { inBed: 0, asleepCore: 0, asleepDeep: 0, asleepREM: 0, asleepUnspecified: 0, awake: 0 };
}

interface NightAccumulator {
  bySource: Map<string, Record<SleepStage, number>>;
  countsBySource: Map<string, number>;
}

/** Legacy pure helper retained for its focused unit tests. Production derives by epoch below. */
export function assembleNights(records: SleepRecordInput[]): Night[] {
  const nights = new Map<string, NightAccumulator>();
  for (const record of records) {
    const key = nightKeyForSleepRecord(record.startLocalDay, record.startLocalMinute);
    if (key === null) continue;
    const acc = nights.get(key) ?? { bySource: new Map(), countsBySource: new Map() };
    nights.set(key, acc);
    acc.countsBySource.set(record.source, (acc.countsBySource.get(record.source) ?? 0) + 1);
    const stages = acc.bySource.get(record.source) ?? emptyStageSeconds();
    stages[record.stage] += durationSeconds(
      Date.parse(record.startUtcIso),
      Date.parse(record.endUtcIso),
    );
    acc.bySource.set(record.source, stages);
  }
  return [...nights]
    .map(([date, acc]) => {
      const sourceSeconds: Record<string, number> = {};
      const sourceRecordCounts: Record<string, number> = {};
      const sources = [...acc.bySource.keys()].sort();
      let winner = sources[0] ?? "";
      for (const source of sources) {
        const stages = acc.bySource.get(source) ?? emptyStageSeconds();
        sourceRecordCounts[source] = acc.countsBySource.get(source) ?? 0;
        sourceSeconds[source] = SLEEP_STAGES.filter((stage) => stage !== "awake").reduce(
          (sum, stage) => sum + stages[stage],
          0,
        );
        if (sourceSeconds[source] > (sourceSeconds[winner] ?? -1)) winner = source;
      }
      return {
        date,
        dominantSource: winner,
        stageSeconds: { ...(acc.bySource.get(winner) ?? emptyStageSeconds()) },
        sourceSeconds,
        sourceRecordCounts,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface DbRecord {
  id: number;
  type: string;
  sourceName: string;
  startAt: string;
  endAt: string;
  startOffsetMin: number | null;
  value: number | null;
  valueStr: string | null;
  metaJson: string | null;
  deviceHw: string | null;
}

class EpochResolver {
  constructor(
    private readonly epochIds: Map<string, number>,
    private readonly inheritedBySourceDay: Map<string, number>,
  ) {}

  get(
    record: Pick<DbRecord, "sourceName" | "deviceHw" | "startAt" | "startOffsetMin">,
  ): number | null {
    if (record.deviceHw !== null)
      return this.epochIds.get(epochKey(record.sourceName, record.deviceHw)) ?? null;
    const day = utcToLocal(record.startAt, record.startOffsetMin ?? 0).localDay;
    return (
      this.inheritedBySourceDay.get(`${record.sourceName}\0${day}`) ??
      this.epochIds.get(epochKey(record.sourceName, "")) ??
      null
    );
  }
}

interface AsleepInterval {
  start: number;
  end: number;
  day: string;
}

interface NightEpochAggregate {
  date: string;
  epochId: number;
  stages: Record<SleepStage, number>;
  asleepIntervals: AsleepInterval[];
}

interface MetricAggregate {
  count: number;
  sum: number;
  values: number[] | null;
  fixedValue: number | null;
}

function epochKey(source: string, hardware: string): string {
  return `${source}\0${hardware}`;
}

function groupKey(metric: string, epochId: number, day: string): string {
  return `${metric}\0${epochId}\0${day}`;
}

function newMetricAggregate(spec: MetricSpec): MetricAggregate {
  return { count: 0, sum: 0, values: spec.method === "median" ? [] : null, fixedValue: null };
}

function addMetricValue(
  aggregates: Map<string, MetricAggregate>,
  metric: string,
  epochId: number,
  day: string,
  value: number,
): void {
  const spec = METRICS[metric];
  if (!spec) return;
  const key = groupKey(metric, epochId, day);
  const aggregate = aggregates.get(key) ?? newMetricAggregate(spec);
  aggregate.count++;
  aggregate.sum += value;
  aggregate.values?.push(value);
  aggregates.set(key, aggregate);
}

function addPresence(
  aggregates: Map<string, MetricAggregate>,
  metric: string,
  epochId: number,
  day: string,
  value: number,
): void {
  const key = groupKey(metric, epochId, day);
  aggregates.set(key, { count: 1, sum: value, values: null, fixedValue: value });
}

function aggregateValue(metric: string, aggregate: MetricAggregate): number | null {
  if (aggregate.fixedValue !== null) return aggregate.fixedValue;
  const spec = METRICS[metric];
  if (!spec || aggregate.count === 0) return null;
  if (spec.method === "sum") return aggregate.sum;
  const values = aggregate.values;
  if (!values || values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? (values[middle] ?? null)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function parseZone(record: Pick<DbRecord, "metaJson">, fallbackOffset: number): string {
  const raw = record.metaJson;
  if (raw) {
    const cached = parsedZoneCache.get(raw);
    if (cached !== undefined) return cached ?? offsetZone(fallbackOffset);
    try {
      const zone = (JSON.parse(raw) as Record<string, unknown>).HKTimeZone;
      if (typeof zone === "string" && zone.length > 0) {
        let valid = validZoneCache.get(zone);
        if (valid === undefined) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: zone });
            valid = true;
          } catch {
            valid = false;
          }
          validZoneCache.set(zone, valid);
        }
        if (valid) {
          if (parsedZoneCache.size < 4096) parsedZoneCache.set(raw, zone);
          return zone;
        }
      }
    } catch {
      // Invalid metadata falls back to the export offset.
    }
    if (parsedZoneCache.size < 4096) parsedZoneCache.set(raw, null);
  }
  return offsetZone(fallbackOffset);
}

function offsetZone(offset: number): string {
  return `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

function epochResolver(db: Database, persistedEpochs?: PersistedEpochDerivation): EpochResolver {
  if (persistedEpochs)
    return new EpochResolver(persistedEpochs.epochIds, persistedEpochs.inheritedEpochIds);
  const epochIds = new Map<string, number>();
  for (const row of db
    .query("SELECT id, source_name AS sourceName, device_hw AS deviceHw FROM epochs")
    .iterate() as Iterable<{ id: number; sourceName: string; deviceHw: string }>)
    epochIds.set(epochKey(row.sourceName, row.deviceHw), row.id);
  const relevantTypes = [
    ...new Set(
      Object.values(METRICS)
        .flatMap((spec) => spec.types)
        .concat(SLEEP_TYPE),
    ),
  ];
  const typePlaceholders = relevantTypes.map(() => "?").join(",");
  const sources = [
    ...new Set(
      [
        ...(db
          .query(
            `SELECT DISTINCT source_name AS sourceName FROM records WHERE type IN (${typePlaceholders})`,
          )
          .iterate(...relevantTypes) as Iterable<{ sourceName: string }>),
      ].map((row) => row.sourceName),
    ),
  ];
  if (sources.length === 0) return new EpochResolver(epochIds, new Map());
  const sourcePlaceholders = sources.map(() => "?").join(",");
  const localDay = "date(start_at, printf('%+d minutes', coalesce(start_offset_min, 0)))";
  const deviceDaysBySource = new Map<
    string,
    Map<string, Map<string, { firstAt: string; lastAt: string }>>
  >();
  for (const row of db
    .query(
      `SELECT source_name AS sourceName, ${localDay} AS localDay, device_hw AS deviceHw,
            MIN(start_at) AS firstAt, MAX(start_at) AS lastAt FROM records
     WHERE device_hw IS NOT NULL AND source_name IN (${sourcePlaceholders})
     GROUP BY source_name, 2, device_hw ORDER BY source_name, 2`,
    )
    .iterate(...sources) as Iterable<{
    sourceName: string;
    localDay: string;
    deviceHw: string;
    firstAt: string;
    lastAt: string;
  }>) {
    const days = deviceDaysBySource.get(row.sourceName) ?? new Map();
    const devices = days.get(row.localDay) ?? new Map();
    devices.set(row.deviceHw, { firstAt: row.firstAt, lastAt: row.lastAt });
    days.set(row.localDay, devices);
    deviceDaysBySource.set(row.sourceName, days);
  }
  const orderedDevices = new Map(
    [...deviceDaysBySource].map(([source, days]) => [
      source,
      [...days]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, devices]) => ({ day, devices: [...devices] })),
    ]),
  );
  const inheritedBySourceDay = new Map<string, number>();
  for (const row of db
    .query(
      `SELECT source_name AS sourceName, ${localDay} AS localDay,
            MIN(start_at) AS firstAt, MAX(start_at) AS lastAt FROM records
     WHERE device_hw IS NULL AND source_name IN (${sourcePlaceholders})
     GROUP BY source_name, 2 ORDER BY source_name, 2`,
    )
    .iterate(...sources) as Iterable<{
    sourceName: string;
    localDay: string;
    firstAt: string;
    lastAt: string;
  }>) {
    const candidates = orderedDevices.get(row.sourceName) ?? [];
    let low = 0;
    let high = candidates.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((candidates[middle]?.day ?? "") < row.localDay) low = middle + 1;
      else high = middle;
    }
    let best: { hardware: string; dayDistance: number; timeDistance: number } | null = null;
    const targetDay = Date.parse(`${row.localDay}T00:00:00Z`);
    for (const index of [low - 1, low]) {
      const candidateDay = candidates[index];
      if (!candidateDay) continue;
      const dayDistance =
        Math.abs(Date.parse(`${candidateDay.day}T00:00:00Z`) - targetDay) / 86_400_000;
      if (dayDistance > 30) continue;
      for (const [hardware, timeRange] of candidateDay.devices) {
        const first = Date.parse(timeRange.firstAt);
        const last = Date.parse(timeRange.lastAt);
        const start = Date.parse(row.firstAt);
        const end = Date.parse(row.lastAt);
        const timeDistance = end < first ? first - end : last < start ? start - last : 0;
        if (
          best === null ||
          dayDistance < best.dayDistance ||
          (dayDistance === best.dayDistance && timeDistance < best.timeDistance) ||
          (dayDistance === best.dayDistance &&
            timeDistance === best.timeDistance &&
            hardware < best.hardware)
        )
          best = { hardware, dayDistance, timeDistance };
      }
    }
    const epochId = best
      ? epochIds.get(epochKey(row.sourceName, best.hardware))
      : epochIds.get(epochKey(row.sourceName, ""));
    if (epochId !== undefined)
      inheritedBySourceDay.set(`${row.sourceName}\0${row.localDay}`, epochId);
  }
  return new EpochResolver(epochIds, inheritedBySourceDay);
}

interface NightWindow {
  day: string;
  zone: string;
  start: number;
  hrvStart: number;
  end: number;
}

function buildNightWindows(
  nightZones: Map<string, Map<string, number>>,
): Map<string, NightWindow[]> {
  const windows = new Map<string, NightWindow[]>();
  for (const [day, zones] of nightZones) {
    const orderedZones = [...zones].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    windows.set(
      day,
      orderedZones.map(([zone]) => ({
        day,
        zone,
        start: zoneLocalToUtc(day, NIGHT_START_MINUTE, zone),
        hrvStart: zoneLocalToUtc(day, 21 * 60, zone),
        end: zoneLocalToUtc(addDays(day, 1), NIGHT_END_MINUTE, zone),
      })),
    );
  }
  return windows;
}

function nearestNightDay(
  utc: string,
  initialZone: string,
  windows: Map<string, NightWindow[]>,
  metric: string,
): { day: string; zone: string } | null {
  const initial = instantInZone(utc, initialZone);
  const time = Date.parse(utc);
  for (let offset = -2; offset <= 2; offset++) {
    const candidateDay = addDays(initial.localDay, offset);
    for (const window of windows.get(candidateDay) ?? []) {
      if (time < window.start || time >= window.end) continue;
      if (metric.startsWith("hrv_") && time < window.hrvStart) continue;
      return { day: window.day, zone: window.zone };
    }
  }
  return null;
}

function dbRecords(db: Database, sql: string, bindings: string[] = []): Iterable<DbRecord> {
  return db.query(sql).iterate(...bindings) as Iterable<DbRecord>;
}

function makeRecordSql(where: string, orderBy = ""): string {
  return `SELECT id, type, source_name AS sourceName, start_at AS startAt, end_at AS endAt,
    start_offset_min AS startOffsetMin, value, value_str AS valueStr, meta_json AS metaJson,
    device_hw AS deviceHw FROM records WHERE ${where}${orderBy ? ` ORDER BY ${orderBy}` : ""}`;
}

function countPresence(
  aggregates: Map<string, MetricAggregate>,
  nights: Map<string, NightEpochAggregate>,
): void {
  for (const night of nights.values()) {
    const asleep =
      night.stages.asleepCore +
      night.stages.asleepDeep +
      night.stages.asleepREM +
      night.stages.asleepUnspecified;
    if (asleep <= 0) continue;
    addPresence(aggregates, "sleep_h", night.epochId, night.date, asleep / 3600);
    addPresence(aggregates, "deep_h", night.epochId, night.date, night.stages.asleepDeep / 3600);
    addPresence(aggregates, "rem_h", night.epochId, night.date, night.stages.asleepREM / 3600);
  }
}

function buildStintIndex(stints: Stint[]): (metric: string, day: string) => number | null {
  const byMetric = new Map<string, Stint[]>();
  for (const stint of stints)
    byMetric.set(stint.metric, [...(byMetric.get(stint.metric) ?? []), stint]);
  for (const rows of byMetric.values()) rows.sort((a, b) => a.startDay.localeCompare(b.startDay));
  return (metric, day) => {
    const rows = byMetric.get(metric) ?? [];
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((rows[middle]?.startDay ?? "") <= day) low = middle + 1;
      else high = middle;
    }
    const candidate = rows[low - 1];
    return candidate && (candidate.endDay === null || candidate.endDay >= day)
      ? candidate.epochId
      : null;
  };
}

function gatherSleep(
  db: Database,
  resolver: EpochResolver,
  exportOffset: number,
): { nights: Map<string, NightEpochAggregate>; zones: Map<string, Map<string, number>> } {
  const nights = new Map<string, NightEpochAggregate>();
  const zones = new Map<string, Map<string, number>>();
  const lastEnd = new Map<string, number>();
  const sql = makeRecordSql("type = ?", "source_name, start_at, id");
  for (const record of dbRecords(db, sql, [SLEEP_TYPE])) {
    const stage = SLEEP_VALUE_STAGE[record.valueStr ?? ""];
    if (!stage) continue;
    const epochId = resolver.get(record);
    if (epochId === null) continue;
    const zone = parseZone(record, exportOffset);
    const local = instantInZone(record.startAt, zone);
    let day = nightKeyForSleepRecord(local.localDay, local.localMinute);
    const start = Date.parse(record.startAt);
    const end = Date.parse(record.endAt);
    const stateKey = `${epochId}\0${addDays(local.localDay, -1)}`;
    if (
      day === null &&
      ASLEEP.has(stage) &&
      local.localMinute >= NIGHT_END_MINUTE &&
      local.localMinute < CONTINUATION_END_MINUTE
    ) {
      const previousEnd = lastEnd.get(stateKey);
      if (
        previousEnd !== undefined &&
        start >= previousEnd &&
        start - previousEnd <= CONTINUATION_TOLERANCE_MS
      )
        day = addDays(local.localDay, -1);
    }
    if (day === null) continue;
    const key = groupKey("sleep_h", epochId, day);
    const night = nights.get(key) ?? {
      date: day,
      epochId,
      stages: emptyStageSeconds(),
      asleepIntervals: [],
    };
    night.stages[stage] += durationSeconds(start, end);
    if (ASLEEP.has(stage)) {
      night.asleepIntervals.push({ start, end, day });
      const endKey = `${epochId}\0${day}`;
      lastEnd.set(endKey, Math.max(lastEnd.get(endKey) ?? Number.NEGATIVE_INFINITY, end));
    }
    nights.set(key, night);
    const zoneCounts = zones.get(day) ?? new Map<string, number>();
    zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + 1);
    zones.set(day, zoneCounts);
  }
  return { nights, zones };
}

interface AsleepIntervalIndex {
  intervalsByEpoch: Map<number, AsleepInterval[]>;
  cursors: Map<number, number>;
}

function buildAsleepIntervalIndex(nights: Map<string, NightEpochAggregate>): AsleepIntervalIndex {
  const intervalsByEpoch = new Map<number, AsleepInterval[]>();
  for (const night of nights.values()) {
    const rows = intervalsByEpoch.get(night.epochId) ?? [];
    rows.push(...night.asleepIntervals);
    intervalsByEpoch.set(night.epochId, rows);
  }
  for (const intervals of intervalsByEpoch.values()) {
    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    let write = 0;
    for (const interval of intervals) {
      const previous = intervals[write - 1];
      if (previous && previous.day === interval.day && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
      } else {
        intervals[write++] = interval;
      }
    }
    intervals.length = write;
  }
  return { intervalsByEpoch, cursors: new Map() };
}

function asleepIntervalAt(
  index: AsleepIntervalIndex,
  epochId: number,
  time: number,
): AsleepInterval | null {
  const intervals = index.intervalsByEpoch.get(epochId);
  if (!intervals) return null;
  let cursor = index.cursors.get(epochId) ?? 0;
  while (cursor < intervals.length && (intervals[cursor]?.end ?? Infinity) <= time) cursor++;
  index.cursors.set(epochId, cursor);
  const interval = intervals[cursor];
  return interval && interval.start <= time && interval.end > time ? interval : null;
}

function metricUnitRows(
  aggregates: Map<string, MetricAggregate>,
  epochKinds: Map<number, MetricUnit["epochKind"]>,
): MetricUnit[] {
  const units: MetricUnit[] = [];
  for (const [key, aggregate] of aggregates) {
    const [metric, rawEpoch, unitDay] = key.split("\0");
    if (!metric || !rawEpoch || !unitDay) continue;
    const value = aggregateValue(metric, aggregate);
    const epochId = Number(rawEpoch);
    const epochKind = epochKinds.get(epochId);
    if (value === null || epochKind === undefined) continue;
    const spec = METRICS[metric];
    units.push({
      metric,
      epochId,
      epochKind,
      unitDay,
      unitKind: spec?.kind === "daytime" || spec?.kind === "trendOnly" ? "day" : "night",
      value,
      n: aggregate.count,
    });
  }
  return units;
}

function persistStints(db: Database, stints: Stint[]): void {
  db.exec("DELETE FROM stints");
  const insert = db.prepare(
    "INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES (?, ?, ?, ?)",
  );
  for (const stint of stints) insert.run(stint.metric, stint.epochId, stint.startDay, stint.endDay);
}

function persistNightValues(
  db: Database,
  nightsByEpoch: Map<string, NightEpochAggregate>,
  zonesByDay: Map<string, Map<string, number>>,
  aggregates: Map<string, MetricAggregate>,
  stints: Stint[],
  exportAt: string | null,
): DerivedNight[] {
  const primaryEpoch = buildStintIndex(stints);
  const nightDates = [...zonesByDay.keys()].sort();
  const nights: DerivedNight[] = [];
  const nightByDate = new Map<string, DerivedNight>();
  let previousZone: string | null = null;
  for (const day of nightDates) {
    const zone =
      [...(zonesByDay.get(day) ?? [])].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0] ?? "UTC";
    const epochId = primaryEpoch("sleep_h", day);
    const stageAgg =
      epochId === null ? undefined : nightsByEpoch.get(groupKey("sleep_h", epochId, day));
    const stages = stageAgg?.stages ?? emptyStageSeconds();
    const asleepS =
      stages.asleepCore + stages.asleepDeep + stages.asleepREM + stages.asleepUnspecified;
    const night: DerivedNight = {
      date: day,
      zone,
      tzChange: previousZone !== null && previousZone !== zone ? 1 : 0,
      partialReason: exportCutReason(day, zone, exportAt),
      asleepS,
      coreS: stages.asleepCore,
      deepS: stages.asleepDeep,
      remS: stages.asleepREM,
      inBedS: stages.inBed,
    };
    nights.push(night);
    nightByDate.set(day, night);
    previousZone = zone;
    if (epochId !== null && asleepS > 0) {
      for (const [metric, value] of [
        ["sleep_h", asleepS / 3600],
        ["deep_h", stages.asleepDeep / 3600],
        ["rem_h", stages.asleepREM / 3600],
      ] as const) {
        aggregates.set(groupKey(metric, epochId, day), {
          count: 1,
          sum: value,
          values: null,
          fixedValue: value,
        });
      }
    }
  }

  const insertMetric = db.prepare(
    "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [key, aggregate] of aggregates) {
    const [metric, rawEpoch, day] = key.split("\0");
    if (!metric || !rawEpoch || !day) continue;
    const spec = METRICS[metric];
    if (!spec || primaryEpoch(metric, day) !== Number(rawEpoch)) continue;
    const value = aggregateValue(metric, aggregate);
    if (value === null) continue;
    const night = nightByDate.get(day);
    const unitKind = spec.kind === "daytime" || spec.kind === "trendOnly" ? "day" : "night";
    if (unitKind === "night" && !night) continue;
    const complete = unitKind !== "night" || night?.partialReason === null;
    const usable = complete && aggregate.count >= spec.minSamples ? 1 : 0;
    insertMetric.run(metric, Number(rawEpoch), day, unitKind, value, aggregate.count, usable);
  }

  const insertNight = db.prepare(
    "INSERT INTO nights (date, zone, tz_change, partial_reason, asleep_s, core_s, deep_s, rem_s, in_bed_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const night of nights)
    insertNight.run(
      night.date,
      night.zone,
      night.tzChange,
      night.partialReason,
      night.asleepS,
      night.coreS,
      night.deepS,
      night.remS,
      night.inBedS,
    );
  return nights;
}

type DerivePhase = "epochs" | "resolver" | "sleep" | "metrics" | "stints" | "persist" | "nights";

type PhaseObserver = (phase: DerivePhase, elapsedMs: number) => void;

function derivePresenceAndValues(
  db: Database,
  rebuildEpochTable: boolean,
  onPhase?: PhaseObserver,
  persistedEpochs?: PersistedEpochDerivation,
): DerivedNight[] {
  if (!persistedEpochs && rebuildEpochTable) persistedEpochs = rebuildEpochs(db);
  const latestExport = db
    .query(
      "SELECT export_date AS exportDate FROM imports WHERE export_date IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get() as { exportDate: string } | null;
  const parsedExport = latestExport ? parseHealthKitDate(latestExport.exportDate) : null;
  const exportOffset = parsedExport?.ok ? parsedExport.date.offsetMinutes : 0;
  const exportDay = parsedExport?.ok ? parsedExport.date.localDay : null;
  const exportAt = parsedExport?.ok ? parsedExport.date.utcIso : null;
  let phaseStart = performance.now();
  const resolver = epochResolver(db, persistedEpochs);
  onPhase?.("resolver", performance.now() - phaseStart);
  phaseStart = performance.now();
  const epochKinds = new Map<number, MetricUnit["epochKind"]>();
  for (const row of db.query("SELECT id, kind FROM epochs").iterate() as Iterable<{
    id: number;
    kind: MetricUnit["epochKind"];
  }>)
    epochKinds.set(row.id, row.kind);

  const { nights, zones } = gatherSleep(db, resolver, exportOffset);
  const asleepIndex = buildAsleepIntervalIndex(nights);
  const nightWindows = buildNightWindows(zones);
  onPhase?.("sleep", performance.now() - phaseStart);
  phaseStart = performance.now();
  const aggregates = new Map<string, MetricAggregate>();
  const typeList = [
    ...new Set(
      Object.values(METRICS)
        .flatMap((spec) => spec.types)
        .filter((type) => type !== SLEEP_TYPE && type !== "HKQuantityTypeIdentifierHeartRate"),
    ),
  ];
  const placeholders = typeList.map(() => "?").join(",");
  const sql = makeRecordSql(`type IN (${placeholders})`);
  for (const record of dbRecords(db, sql, typeList)) {
    const spec = METRIC_BY_TYPE.get(record.type);
    if (!spec || record.value === null) continue;
    const epochId = resolver.get(record);
    if (epochId === null) continue;
    if (spec.kind === "daytime" || spec.kind === "trendOnly") {
      const day = utcToLocal(record.startAt, exportOffset).localDay;
      if (day !== exportDay) addMetricValue(aggregates, spec.key, epochId, day, record.value);
      continue;
    }
    const night = nearestNightDay(
      record.startAt,
      parseZone(record, exportOffset),
      nightWindows,
      spec.key,
    );
    if (night) addMetricValue(aggregates, spec.key, epochId, night.day, record.value);
  }

  const heartRateType = "HKQuantityTypeIdentifierHeartRate";
  for (const record of dbRecords(db, makeRecordSql("type = ?", "source_name, start_at, id"), [
    heartRateType,
  ])) {
    if (record.value === null) continue;
    const epochId = resolver.get(record);
    if (epochId === null) continue;
    const asleep = asleepIntervalAt(asleepIndex, epochId, Date.parse(record.startAt));
    if (asleep) addMetricValue(aggregates, "sleep_hr", epochId, asleep.day, record.value);
    const day = utcToLocal(record.startAt, exportOffset).localDay;
    if (day !== exportDay) addMetricValue(aggregates, "heart_rate", epochId, day, record.value);
  }

  onPhase?.("metrics", performance.now() - phaseStart);
  const ownsTransaction = !db.inTransaction;
  if (ownsTransaction) db.exec("BEGIN");
  try {
    phaseStart = performance.now();
    const stints = rebuildEpochTableStints(db, nights, aggregates, epochKinds);
    onPhase?.("stints", performance.now() - phaseStart);
    phaseStart = performance.now();
    db.exec("DELETE FROM metric_values; DELETE FROM nights;");
    const nightRows = persistNightValues(db, nights, zones, aggregates, stints, exportAt);
    if (ownsTransaction) db.exec("COMMIT");
    onPhase?.("persist", performance.now() - phaseStart);
    return nightRows;
  } catch (error) {
    if (ownsTransaction && db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function rebuildEpochTableStints(
  db: Database,
  nights: Map<string, NightEpochAggregate>,
  aggregates: Map<string, MetricAggregate>,
  epochKinds: Map<number, MetricUnit["epochKind"]>,
): Stint[] {
  const presence = new Map(aggregates);
  countPresence(presence, nights);
  const units = metricUnitRows(presence, epochKinds);
  const stints = deriveStints(units, () => true);
  persistStints(db, stints);
  return stints;
}

/**
 * Build epoch presence first, then stints, nights, and values. This is the fresh-database path.
 */
export function rebuildNightPipeline(db: Database, onPhase?: PhaseObserver): DerivedNight[] {
  let start = performance.now();
  const persistedEpochs = rebuildEpochs(db);
  onPhase?.("epochs", performance.now() - start);
  start = performance.now();
  const nights = derivePresenceAndValues(db, false, onPhase, persistedEpochs);
  onPhase?.("nights", performance.now() - start);
  return nights;
}

/** Rebuild nights and metric values using the persisted epoch table; streams relevant records. */
export function rebuildNights(db: Database): DerivedNight[] {
  return derivePresenceAndValues(db, false);
}
