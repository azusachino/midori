import type { Database } from "bun:sqlite";
import { utcToLocal } from "../domain/dates";

const MAX_INHERITANCE_DAYS = 30;
const DAY_MS = 86_400_000;

export type EpochKind = "watch" | "phone" | "app" | "other";

export interface EpochInput {
  id: number;
  sourceName: string;
  deviceHw: string | null;
  deviceSw: string | null;
  startAt: string;
  startOffsetMin: number | null;
}

export interface EpochRow {
  sourceName: string;
  deviceHw: string;
  kind: EpochKind;
  firstDay: string;
  lastDay: string;
  daysPresent: number;
}

export interface EpochEvent {
  sourceName: string;
  deviceHw: string;
  day: string;
  kind: "os_update";
  detail: string;
}

export interface EpochDerivation {
  epochs: EpochRow[];
  assignments: Array<{ recordId: number; sourceName: string; deviceHw: string }>;
  events: EpochEvent[];
}

function kindOf(deviceHw: string): EpochKind {
  if (deviceHw === "") return "app";
  if (deviceHw.startsWith("Watch")) return "watch";
  if (deviceHw.startsWith("iPhone")) return "phone";
  return "other";
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const isDottedNumeric = /^\d+(?:\.\d+)*$/;
  if (!isDottedNumeric.test(a) || !isDottedNumeric.test(b)) return null;
  const left = a.split(".").map(BigInt);
  const right = b.split(".").map(BigInt);
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i++) {
    const leftPart = left[i] ?? 0n;
    const rightPart = right[i] ?? 0n;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

/** Derive device epochs, inheritance assignments, and software update events. */
export function deriveEpochs(records: readonly EpochInput[]): EpochDerivation {
  const dated = records.map((record) => ({
    ...record,
    day: utcToLocal(record.startAt, record.startOffsetMin ?? 0).localDay,
  }));
  const devicesBySource = new Map<string, Map<string, typeof dated>>();
  for (const record of dated) {
    if (record.deviceHw === null) continue;
    const byDay = devicesBySource.get(record.sourceName) ?? new Map<string, typeof dated>();
    const devicesOnDay = byDay.get(record.day) ?? [];
    devicesOnDay.push(record);
    byDay.set(record.day, devicesOnDay);
    devicesBySource.set(record.sourceName, byDay);
  }
  const deviceDaysBySource = new Map(
    [...devicesBySource].map(([source, byDay]) => [source, [...byDay.keys()].sort()]),
  );

  const resolved = dated.map((record) => {
    let deviceHw = record.deviceHw;
    if (deviceHw === null) {
      const byDay = devicesBySource.get(record.sourceName);
      const deviceDays = deviceDaysBySource.get(record.sourceName) ?? [];
      let low = 0;
      let high = deviceDays.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if ((deviceDays[middle] ?? "") < record.day) low = middle + 1;
        else high = middle;
      }

      let nearest: (typeof dated)[number] | undefined;
      let nearestDayDistance = Number.POSITIVE_INFINITY;
      let nearestTimeDistance = Number.POSITIVE_INFINITY;
      for (const dayIndex of [low - 1, low]) {
        const candidateDay = deviceDays[dayIndex];
        if (candidateDay === undefined) continue;
        const distance = dayDistance(record.day, candidateDay);
        if (distance > MAX_INHERITANCE_DAYS || distance > nearestDayDistance) continue;
        for (const candidate of byDay?.get(candidateDay) ?? []) {
          const timeDistance = Math.abs(Date.parse(record.startAt) - Date.parse(candidate.startAt));
          if (
            distance < nearestDayDistance ||
            timeDistance < nearestTimeDistance ||
            (timeDistance === nearestTimeDistance &&
              (candidate.deviceHw ?? "").localeCompare(nearest?.deviceHw ?? "") < 0) ||
            (timeDistance === nearestTimeDistance &&
              candidate.deviceHw === nearest?.deviceHw &&
              candidate.id < (nearest?.id ?? Infinity))
          ) {
            nearest = candidate;
            nearestDayDistance = distance;
            nearestTimeDistance = timeDistance;
          }
        }
      }
      deviceHw = nearest?.deviceHw ?? "";
    }
    return { ...record, deviceHw };
  });

  const byEpoch = new Map<string, typeof resolved>();
  for (const record of resolved) {
    const key = JSON.stringify([record.sourceName, record.deviceHw]);
    const rows = byEpoch.get(key) ?? [];
    rows.push(record);
    byEpoch.set(key, rows);
  }

  const epochs: EpochRow[] = [];
  const events: EpochEvent[] = [];
  for (const rows of byEpoch.values()) {
    const first = rows[0];
    if (!first) continue;
    const days = [...new Set(rows.map((row) => row.day))].sort();
    epochs.push({
      sourceName: first.sourceName,
      deviceHw: first.deviceHw,
      kind: kindOf(first.deviceHw),
      firstDay: days[0] as string,
      lastDay: days[days.length - 1] as string,
      daysPresent: days.length,
    });

    const softwareRecords = rows
      .filter((row) => row.deviceHw !== "" && row.deviceSw !== null)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id - b.id);
    let newestSoftware: string | null = null;
    for (const record of softwareRecords) {
      const version = record.deviceSw;
      if (version === null) continue;
      if (newestSoftware === null) {
        if (compareVersions(version, version) !== null) newestSoftware = version;
        continue;
      }
      const order = compareVersions(version, newestSoftware);
      if (order !== 1) continue;
      events.push({
        sourceName: record.sourceName,
        deviceHw: record.deviceHw,
        day: record.day,
        kind: "os_update",
        detail: `${newestSoftware} → ${version}`,
      });
      newestSoftware = version;
    }
  }

  epochs.sort(
    (a, b) => a.sourceName.localeCompare(b.sourceName) || a.deviceHw.localeCompare(b.deviceHw),
  );
  return {
    epochs,
    assignments: resolved.map(({ id, sourceName, deviceHw }) => ({
      recordId: id,
      sourceName,
      deviceHw,
    })),
    events,
  };
}

export interface PersistedEpochDerivation {
  epochs: EpochRow[];
  events: EpochEvent[];
  epochIds: Map<string, number>;
  inheritedEpochIds: Map<string, number>;
}

interface EpochGroupRow {
  sourceName: string;
  localDay: string;
  deviceHw: string | null;
  deviceSw: string | null;
  firstAt: string;
  lastAt: string;
  firstId: number;
}

interface DeviceCandidate {
  deviceHw: string;
  firstAt: string;
  lastAt: string;
}

interface DeviceDay {
  day: string;
  candidates: DeviceCandidate[];
}

interface EpochAccumulator {
  sourceName: string;
  deviceHw: string;
  days: Set<string>;
  software: Array<{ deviceSw: string; day: string; firstAt: string; firstId: number }>;
}

const epochMapKey = (sourceName: string, deviceHw: string) => `${sourceName}\0${deviceHw}`;

function rangeDistance(targetStart: string, targetEnd: string, candidate: DeviceCandidate): number {
  const targetStartMs = Date.parse(targetStart);
  const targetEndMs = Date.parse(targetEnd);
  const candidateStartMs = Date.parse(candidate.firstAt);
  const candidateEndMs = Date.parse(candidate.lastAt);
  if (targetEndMs < candidateStartMs) return candidateStartMs - targetEndMs;
  if (candidateEndMs < targetStartMs) return targetStartMs - candidateEndMs;
  return 0;
}

function nearestDevice(
  sourceDays: DeviceDay[] | undefined,
  localDay: string,
  firstAt: string,
  lastAt: string,
): string {
  if (!sourceDays?.length) return "";
  let low = 0;
  let high = sourceDays.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sourceDays[middle]?.day ?? "") < localDay) low = middle + 1;
    else high = middle;
  }
  let best: { deviceHw: string; dayDistance: number; timeDistance: number } | null = null;
  const targetDayMs = Date.parse(`${localDay}T00:00:00Z`);
  for (const index of [low - 1, low]) {
    const candidateDay = sourceDays[index];
    if (!candidateDay) continue;
    const dayDistance =
      Math.abs(Date.parse(`${candidateDay.day}T00:00:00Z`) - targetDayMs) / DAY_MS;
    if (dayDistance > MAX_INHERITANCE_DAYS) continue;
    for (const candidate of candidateDay.candidates) {
      const timeDistance = rangeDistance(firstAt, lastAt, candidate);
      if (
        best === null ||
        dayDistance < best.dayDistance ||
        (dayDistance === best.dayDistance && timeDistance < best.timeDistance) ||
        (dayDistance === best.dayDistance &&
          timeDistance === best.timeDistance &&
          candidate.deviceHw < best.deviceHw)
      )
        best = { deviceHw: candidate.deviceHw, dayDistance, timeDistance };
    }
  }
  return best?.deviceHw ?? "";
}

/** Rebuild persisted epochs from grouped rows without retaining record assignments. */
export function rebuildEpochs(db: Database): PersistedEpochDerivation {
  const localDay = "date(start_at, printf('%+d minutes', coalesce(start_offset_min, 0)))";
  const groups = db
    .query(
      `SELECT source_name AS sourceName, ${localDay} AS localDay,
            device_hw AS deviceHw, device_sw AS deviceSw,
            MIN(start_at) AS firstAt, MAX(start_at) AS lastAt, MIN(id) AS firstId
     FROM records
     GROUP BY source_name, 2, device_hw, device_sw
     ORDER BY source_name, 2, firstAt, firstId`,
    )
    .iterate() as Iterable<EpochGroupRow>;

  const deviceDaysBySource = new Map<string, Map<string, Map<string, DeviceCandidate>>>();
  const accumulatorByKey = new Map<string, EpochAccumulator>();
  const unresolved: EpochGroupRow[] = [];
  for (const row of groups) {
    if (row.deviceHw === null) {
      unresolved.push(row);
      continue;
    }
    const epochKey = epochMapKey(row.sourceName, row.deviceHw);
    const epoch = accumulatorByKey.get(epochKey) ?? {
      sourceName: row.sourceName,
      deviceHw: row.deviceHw,
      days: new Set<string>(),
      software: [],
    };
    epoch.days.add(row.localDay);
    if (row.deviceSw !== null)
      epoch.software.push({
        deviceSw: row.deviceSw,
        day: row.localDay,
        firstAt: row.firstAt,
        firstId: row.firstId,
      });
    accumulatorByKey.set(epochKey, epoch);

    const days = deviceDaysBySource.get(row.sourceName) ?? new Map();
    const byHardware = days.get(row.localDay) ?? new Map<string, DeviceCandidate>();
    const candidate = byHardware.get(row.deviceHw);
    byHardware.set(
      row.deviceHw,
      candidate
        ? {
            deviceHw: row.deviceHw,
            firstAt: minIso(candidate.firstAt, row.firstAt),
            lastAt: maxIso(candidate.lastAt, row.lastAt),
          }
        : { deviceHw: row.deviceHw, firstAt: row.firstAt, lastAt: row.lastAt },
    );
    days.set(row.localDay, byHardware);
    deviceDaysBySource.set(row.sourceName, days);
  }

  const orderedDeviceDays = new Map<string, DeviceDay[]>();
  for (const [sourceName, days] of deviceDaysBySource)
    orderedDeviceDays.set(
      sourceName,
      [...days]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, candidates]) => ({ day, candidates: [...candidates.values()] })),
    );
  const inheritedHardwareBySourceDay = new Map<string, string>();
  for (const row of unresolved) {
    const deviceHw = nearestDevice(
      orderedDeviceDays.get(row.sourceName),
      row.localDay,
      row.firstAt,
      row.lastAt,
    );
    inheritedHardwareBySourceDay.set(`${row.sourceName}\0${row.localDay}`, deviceHw);
    const key = epochMapKey(row.sourceName, deviceHw);
    const epoch = accumulatorByKey.get(key) ?? {
      sourceName: row.sourceName,
      deviceHw,
      days: new Set<string>(),
      software: [],
    };
    epoch.days.add(row.localDay);
    accumulatorByKey.set(key, epoch);
  }

  const epochs = [...accumulatorByKey.values()]
    .map((epoch): EpochRow => {
      const days = [...epoch.days].sort();
      return {
        sourceName: epoch.sourceName,
        deviceHw: epoch.deviceHw,
        kind: kindOf(epoch.deviceHw),
        firstDay: days[0] ?? "",
        lastDay: days[days.length - 1] ?? "",
        daysPresent: days.length,
      };
    })
    .sort(
      (a, b) => a.sourceName.localeCompare(b.sourceName) || a.deviceHw.localeCompare(b.deviceHw),
    );
  const events: EpochEvent[] = [];
  for (const epoch of accumulatorByKey.values()) {
    if (epoch.deviceHw === "") continue;
    let newestSoftware: string | null = null;
    epoch.software.sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.firstId - b.firstId);
    for (const record of epoch.software) {
      if (newestSoftware === null) {
        if (compareVersions(record.deviceSw, record.deviceSw) !== null)
          newestSoftware = record.deviceSw;
        continue;
      }
      if (compareVersions(record.deviceSw, newestSoftware) !== 1) continue;
      events.push({
        sourceName: epoch.sourceName,
        deviceHw: epoch.deviceHw,
        day: record.day,
        kind: "os_update",
        detail: `${newestSoftware} → ${record.deviceSw}`,
      });
      newestSoftware = record.deviceSw;
    }
  }

  const epochIds = new Map<string, number>();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM epoch_events; DELETE FROM epochs;");
    const insertEpoch = db.prepare(
      `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const epoch of epochs) {
      const result = insertEpoch.run(
        epoch.sourceName,
        epoch.deviceHw,
        epoch.kind,
        epoch.firstDay,
        epoch.lastDay,
        epoch.daysPresent,
      );
      epochIds.set(epochMapKey(epoch.sourceName, epoch.deviceHw), Number(result.lastInsertRowid));
    }
    const insertEvent = db.prepare(
      `INSERT INTO epoch_events (epoch_id, day, kind, detail) VALUES (?, ?, ?, ?)`,
    );
    for (const event of events) {
      const epochId = epochIds.get(epochMapKey(event.sourceName, event.deviceHw));
      if (epochId !== undefined) insertEvent.run(epochId, event.day, event.kind, event.detail);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const inheritedEpochIds = new Map<string, number>();
  for (const [sourceDay, hardware] of inheritedHardwareBySourceDay) {
    const separator = sourceDay.lastIndexOf("\0");
    const sourceName = sourceDay.slice(0, separator);
    const day = sourceDay.slice(separator + 1);
    const epochId = epochIds.get(epochMapKey(sourceName, hardware));
    if (epochId !== undefined) inheritedEpochIds.set(`${sourceName}\0${day}`, epochId);
  }
  return { epochs, events, epochIds, inheritedEpochIds };
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}
