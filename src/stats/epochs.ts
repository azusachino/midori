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
    let previousSoftware: string | null = null;
    for (const record of softwareRecords) {
      if (previousSoftware !== null && record.deviceSw !== previousSoftware) {
        events.push({
          sourceName: record.sourceName,
          deviceHw: record.deviceHw,
          day: record.day,
          kind: "os_update",
          detail: `${previousSoftware} → ${record.deviceSw}`,
        });
      }
      previousSoftware = record.deviceSw;
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

/** Rebuild the persisted epoch and OS update tables from all stored records. */
export function rebuildEpochs(db: Database): EpochDerivation {
  const records = db
    .prepare(
      `SELECT id, source_name AS sourceName, device_hw AS deviceHw,
              device_sw AS deviceSw, start_at AS startAt,
              start_offset_min AS startOffsetMin
       FROM records ORDER BY start_at, id`,
    )
    .all() as EpochInput[];
  const derived = deriveEpochs(records);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM epoch_events");
    db.exec("DELETE FROM epochs");
    const insertEpoch = db.prepare(
      `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const epochIds = new Map<string, number>();
    for (const epoch of derived.epochs) {
      insertEpoch.run(
        epoch.sourceName,
        epoch.deviceHw,
        epoch.kind,
        epoch.firstDay,
        epoch.lastDay,
        epoch.daysPresent,
      );
      const id = Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
      epochIds.set(JSON.stringify([epoch.sourceName, epoch.deviceHw]), id);
    }
    const insertEvent = db.prepare(
      `INSERT INTO epoch_events (epoch_id, day, kind, detail) VALUES (?, ?, ?, ?)`,
    );
    for (const event of derived.events) {
      const epochId = epochIds.get(JSON.stringify([event.sourceName, event.deviceHw]));
      if (epochId !== undefined) insertEvent.run(epochId, event.day, event.kind, event.detail);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return derived;
}
