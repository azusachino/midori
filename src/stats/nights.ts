import type { Database } from "bun:sqlite";
import { addDays, instantInZone, parseHealthKitDate, zoneLocalToUtc } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { deriveEpochs } from "./epochs";

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

function durationSeconds(start: string, end: string): number {
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
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
    stages[record.stage] += durationSeconds(record.startUtcIso, record.endUtcIso);
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
        sourceSeconds[source] = SLEEP_STAGES.filter((s) => s !== "awake").reduce(
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

interface DerivedNight {
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? (values[middle] ?? null)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function recordZone(record: DbRecord, exportOffset: number): string {
  try {
    const zone = (JSON.parse(record.metaJson ?? "{}") as Record<string, unknown>).HKTimeZone;
    if (typeof zone === "string" && zone.length > 0) {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone;
    }
  } catch {
    // Invalid or absent metadata falls back to the export offset.
  }
  return `UTC${exportOffset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(exportOffset) / 60)).padStart(2, "0")}:${String(Math.abs(exportOffset) % 60).padStart(2, "0")}`;
}

function valueDay(utc: string, offset: number): string {
  return instantInZone(
    utc,
    `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`,
  ).localDay;
}

function zoneForDay(utc: string, zone: string): { localDay: string; localMinute: number } {
  return instantInZone(utc, zone);
}

function primaryForDay(
  stints: Array<{ metric: string; epochId: number; startDay: string; endDay: string | null }>,
  metric: string,
  day: string,
): number | null {
  return (
    stints.find(
      (s) => s.metric === metric && s.startDay <= day && (s.endDay === null || s.endDay >= day),
    )?.epochId ?? null
  );
}

/** Rebuild persisted nights and metric values from records, epochs, and sleep_h primary stints. */
export function rebuildNights(db: Database): DerivedNight[] {
  const records = db
    .prepare(`SELECT id, type, source_name AS sourceName, start_at AS startAt,
    end_at AS endAt, start_offset_min AS startOffsetMin, value, value_str AS valueStr,
    meta_json AS metaJson, device_hw AS deviceHw FROM records ORDER BY start_at, id`)
    .all() as DbRecord[];
  const latestExport = db
    .query(
      "SELECT export_date AS exportDate FROM imports WHERE export_date IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get() as { exportDate: string } | null;
  const parsedExport = latestExport ? parseHealthKitDate(latestExport.exportDate) : null;
  const exportOffset = parsedExport?.ok ? parsedExport.date.offsetMinutes : 0;
  const exportDay = parsedExport?.ok ? valueDay(parsedExport.date.utcIso, exportOffset) : null;
  const epochDerivation = deriveEpochs(
    records.map((r) => ({
      id: r.id,
      sourceName: r.sourceName,
      deviceHw: r.deviceHw,
      deviceSw: null,
      startAt: r.startAt,
      startOffsetMin: r.startOffsetMin,
    })),
  );
  const epochIdByRecord = new Map<number, number>();
  const epochIds = new Map<string, number>();
  for (const row of db
    .query("SELECT id, source_name AS sourceName, device_hw AS deviceHw FROM epochs")
    .all() as Array<{ id: number; sourceName: string; deviceHw: string }>) {
    epochIds.set(JSON.stringify([row.sourceName, row.deviceHw]), row.id);
  }
  for (const assignment of epochDerivation.assignments) {
    const epochId = epochIds.get(JSON.stringify([assignment.sourceName, assignment.deviceHw]));
    if (epochId !== undefined) epochIdByRecord.set(assignment.recordId, epochId);
  }
  const stints = db
    .query(
      "SELECT metric, epoch_id AS epochId, start_day AS startDay, end_day AS endDay FROM stints",
    )
    .all() as Array<{ metric: string; epochId: number; startDay: string; endDay: string | null }>;

  const sleepRecords = records.filter(
    (r) =>
      r.type === "HKCategoryTypeIdentifierSleepAnalysis" && SLEEP_VALUE_STAGE[r.valueStr ?? ""],
  );
  const preliminary: Array<{ record: DbRecord; stage: SleepStage; day: string; zone: string }> = [];
  for (const record of sleepRecords) {
    const zone = recordZone(record, exportOffset);
    const local = zoneForDay(record.startAt, zone);
    const stage = SLEEP_VALUE_STAGE[record.valueStr ?? ""] as SleepStage;
    const day =
      nightKeyForSleepRecord(local.localDay, local.localMinute) ??
      (ASLEEP.has(stage) &&
      local.localMinute >= NIGHT_END_MINUTE &&
      local.localMinute < CONTINUATION_END_MINUTE
        ? addDays(local.localDay, -1)
        : null);
    if (day) preliminary.push({ record, stage, day, zone });
  }
  const zonesByDay = new Map<string, Map<string, number>>();
  for (const item of preliminary) {
    const zones = zonesByDay.get(item.day) ?? new Map<string, number>();
    zones.set(item.zone, (zones.get(item.zone) ?? 0) + 1);
    zonesByDay.set(item.day, zones);
  }
  const nightZones = new Map<string, string>();
  for (const [day, zones] of zonesByDay) {
    nightZones.set(
      day,
      [...zones].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "UTC",
    );
  }

  const assignedSleep: Array<{
    record: DbRecord;
    stage: SleepStage;
    day: string;
    epochId: number;
  }> = [];
  for (const item of preliminary) {
    let day = item.day;
    const local = zoneForDay(item.record.startAt, item.zone);
    if (
      local.localMinute >= NIGHT_END_MINUTE &&
      local.localMinute < CONTINUATION_END_MINUTE &&
      ASLEEP.has(item.stage)
    ) {
      const previous = addDays(local.localDay, -1);
      const primary = primaryForDay(stints, "sleep_h", previous);
      const priorEnds = preliminary
        .filter(
          (p) =>
            p.day === previous &&
            Date.parse(p.record.startAt) < Date.parse(item.record.startAt) &&
            ASLEEP.has(p.stage) &&
            epochIdByRecord.get(p.record.id) === primary,
        )
        .map((p) => Date.parse(p.record.endAt));
      const lastEnd = Math.max(...priorEnds);
      if (
        continuesNight(
          item.record.startAt,
          Number.isFinite(lastEnd) ? new Date(lastEnd).toISOString() : null,
        )
      )
        day = previous;
      else continue;
    }
    const epochId = epochIdByRecord.get(item.record.id);
    if (epochId !== undefined)
      assignedSleep.push({ record: item.record, stage: item.stage, day, epochId });
  }

  const dates = [...new Set(assignedSleep.map((r) => r.day))].sort();
  const nights: DerivedNight[] = [];
  const previousZone = new Map<string, string>();
  for (const day of dates) {
    const stageRecords = assignedSleep.filter(
      (r) => r.day === day && r.epochId === primaryForDay(stints, "sleep_h", day),
    );
    const totals = emptyStageSeconds();
    for (const item of stageRecords)
      totals[item.stage] += durationSeconds(item.record.startAt, item.record.endAt);
    const zone = nightZones.get(day) ?? "UTC";
    const prevZone = previousZone.get("last");
    const nightsRow: DerivedNight = {
      date: day,
      zone,
      tzChange: prevZone !== undefined && prevZone !== zone ? 1 : 0,
      partialReason: exportCutReason(day, zone, parsedExport?.ok ? parsedExport.date.utcIso : null),
      asleepS: totals.asleepCore + totals.asleepDeep + totals.asleepREM + totals.asleepUnspecified,
      coreS: totals.asleepCore,
      deepS: totals.asleepDeep,
      remS: totals.asleepREM,
      inBedS: totals.inBed,
    };
    nights.push(nightsRow);
    previousZone.set("last", zone);
  }

  const nightByDate = new Map(nights.map((n) => [n.date, n]));
  const metricRows: Array<[string, number, string, string, number, number, number]> = [];
  const groups = new Map<string, { values: number[]; n: number }>();
  const primaryRecord = (r: DbRecord, metric: string, day: string) =>
    epochIdByRecord.get(r.id) === primaryForDay(stints, metric, day);
  for (const record of records) {
    const metric = Object.values(METRICS).find((spec) => spec.types.includes(record.type))?.key;
    if (!metric || record.value === null) continue;
    const isSleep = metric === "sleep_h" || metric === "deep_h" || metric === "rem_h";
    if (isSleep) continue;
    if (
      ["rhr", "hrv_sdnn", "hrv_rmssd", "wrist_temp", "resp_rate", "spo2"].includes(metric) ||
      metric === "heart_rate"
    ) {
      if (metric === "heart_rate") {
        const day = valueDay(record.startAt, exportOffset);
        if (day !== exportDay && primaryRecord(record, metric, day)) {
          const key = `${metric}|${epochIdByRecord.get(record.id)}|${day}`;
          const g = groups.get(key) ?? { values: [], n: 0 };
          g.values.push(record.value);
          g.n++;
          groups.set(key, g);
        }
        continue;
      }
      const initialLocal = zoneForDay(record.startAt, recordZone(record, exportOffset));
      const initialDay = initialLocal.localDay;
      const candidateDays = [-2, -1, 0, 1, 2].map((offset) => addDays(initialDay, offset));
      const day = candidateDays.find((candidate) => {
        const zone = nightZones.get(candidate);
        if (zone === undefined) return false;
        const local = zoneForDay(record.startAt, zone);
        const assigned = nightKeyForSleepRecord(local.localDay, local.localMinute);
        const metricDay =
          metric === "rhr" && local.localMinute < NIGHT_END_MINUTE
            ? addDays(local.localDay, -1)
            : assigned;
        return (
          metricDay === candidate &&
          (!metric.startsWith("hrv_") || inHrvNightWindow(local.localMinute))
        );
      });
      if (day === undefined || !nightByDate.has(day)) continue;
      if (!primaryRecord(record, metric, day)) continue;
      const key = `${metric}|${epochIdByRecord.get(record.id)}|${day}`;
      const g = groups.get(key) ?? { values: [], n: 0 };
      g.values.push(record.value);
      g.n++;
      groups.set(key, g);
    } else {
      const day = valueDay(record.startAt, exportOffset);
      if (day === exportDay || !primaryRecord(record, metric, day)) continue;
      const key = `${metric}|${epochIdByRecord.get(record.id)}|${day}`;
      const g = groups.get(key) ?? { values: [], n: 0 };
      g.values.push(record.value);
      g.n++;
      groups.set(key, g);
    }
  }

  for (const night of nights) {
    const day = night.date;
    const epochId = primaryForDay(stints, "sleep_h", day);
    if (epochId !== null && night.asleepS > 0)
      metricRows.push([
        "sleep_h",
        epochId,
        day,
        "night",
        night.asleepS / 3600,
        1,
        night.partialReason === null ? 1 : 0,
      ]);
    if (epochId !== null) {
      for (const [metric, value] of [
        ["deep_h", night.deepS / 3600],
        ["rem_h", night.remS / 3600],
      ] as const) {
        if (night.asleepS > 0)
          metricRows.push([
            metric,
            epochId,
            day,
            "night",
            value,
            1,
            night.partialReason === null ? 1 : 0,
          ]);
      }
    }
    const sleepHrEpoch = primaryForDay(stints, "sleep_hr", day);
    if (epochId !== null && sleepHrEpoch !== null) {
      const asleepIntervals = assignedSleep.filter(
        (r) => r.day === day && r.epochId === epochId && ASLEEP.has(r.stage),
      );
      const heart = records
        .filter(
          (r) =>
            r.type === "HKQuantityTypeIdentifierHeartRate" &&
            primaryRecord(r, "sleep_hr", day) &&
            asleepIntervals.some(
              (interval) =>
                Date.parse(r.startAt) >= Date.parse(interval.record.startAt) &&
                Date.parse(r.startAt) < Date.parse(interval.record.endAt),
            ),
        )
        .flatMap((r) => (r.value === null ? [] : [r.value]));
      const value = median(heart);
      if (value !== null) {
        const minSamples = METRICS.sleep_hr?.minSamples ?? Number.POSITIVE_INFINITY;
        metricRows.push([
          "sleep_hr",
          sleepHrEpoch,
          day,
          "night",
          value,
          heart.length,
          night.partialReason === null && heart.length >= minSamples ? 1 : 0,
        ]);
      }
    }
  }
  for (const [key, group] of groups) {
    const [metric, epoch, day] = key.split("|");
    if (!metric || !epoch || !day) continue;
    const spec = METRICS[metric];
    if (!spec) continue;
    const nightly = nightByDate.has(day);
    const value =
      spec.method === "sum" ? group.values.reduce((sum, n) => sum + n, 0) : median(group.values);
    if (value === null) continue;
    const complete = !nightly || nightByDate.get(day)?.partialReason === null;
    metricRows.push([
      metric,
      Number(epoch),
      day,
      nightly ? "night" : "day",
      value,
      group.n,
      complete && group.n >= spec.minSamples ? 1 : 0,
    ]);
  }

  db.exec("DELETE FROM metric_values; DELETE FROM nights;");
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
  const insertMetric = db.prepare(
    "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of metricRows) insertMetric.run(...row);
  return nights;
}
