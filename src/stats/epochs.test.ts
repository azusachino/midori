import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { REPLACEMENT_SOURCE, replacementWatchSpec } from "../../tests/fixtures/replacement-watch";
import { applyMigrations } from "../db/db";
import { parseHealthKitDate, utcToLocal } from "../domain/dates";
import { devicePart } from "../ingest/parser";
import { deriveEpochs, type EpochInput, rebuildEpochs } from "./epochs";

function fixtureRecords(): EpochInput[] {
  return replacementWatchSpec().records.map((record, id) => {
    const parsed = parseHealthKitDate(record.startDate);
    if (!parsed.ok) throw new Error(`invalid fixture date: ${record.startDate}`);
    return {
      id: id + 1,
      sourceName: record.sourceName,
      deviceHw: devicePart(record.device ?? null, "hardware"),
      deviceSw: devicePart(record.device ?? null, "software"),
      startAt: parsed.date.utcIso,
      startOffsetMin: parsed.date.offsetMinutes,
    };
  });
}

describe("epoch derivation", () => {
  test("B-D1 same-name replacement watch yields two epochs and inherits sleep/RHR", () => {
    const records = fixtureRecords();
    const result = deriveEpochs(records);
    const watches = result.epochs.filter((epoch) => epoch.sourceName === REPLACEMENT_SOURCE);
    expect(watches).toEqual([
      {
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch5,9",
        kind: "watch",
        firstDay: "2026-04-01",
        lastDay: "2026-04-02",
        daysPresent: 2,
      },
      {
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch7,5",
        kind: "watch",
        firstDay: "2026-04-03",
        lastDay: "2026-04-05",
        daysPresent: 3,
      },
    ]);

    const assignmentById = new Map(result.assignments.map((row) => [row.recordId, row.deviceHw]));
    const dayForId = new Map(
      records.map((record) => [
        record.id,
        utcToLocal(record.startAt, record.startOffsetMin ?? 0).localDay,
      ]),
    );
    const inherited = records.filter((record) => record.deviceHw === null);
    expect(
      inherited.map((record) => [dayForId.get(record.id), assignmentById.get(record.id)]),
    ).toEqual([
      ["2026-04-02", "Watch5,9"],
      ["2026-04-02", "Watch5,9"],
      ["2026-04-03", "Watch7,5"],
      ["2026-04-04", "Watch7,5"],
    ]);
  });

  test("B-D2 device-less records outside the inheritance window become app epochs", () => {
    const start = parseHealthKitDate("2026-01-01 07:00:00 +0900");
    const middle = parseHealthKitDate("2026-01-20 07:00:00 +0900");
    const far = parseHealthKitDate("2026-03-01 07:00:00 +0900");
    if (!start.ok || !middle.ok || !far.ok) throw new Error("invalid test date");
    const result = deriveEpochs([
      {
        id: 1,
        sourceName: "Synthetic Source",
        deviceHw: "Watch5,9",
        deviceSw: "10.0",
        startAt: start.date.utcIso,
        startOffsetMin: start.date.offsetMinutes,
      },
      {
        id: 2,
        sourceName: "Synthetic Source",
        deviceHw: null,
        deviceSw: null,
        startAt: middle.date.utcIso,
        startOffsetMin: middle.date.offsetMinutes,
      },
      {
        id: 3,
        sourceName: "Synthetic Source",
        deviceHw: null,
        deviceSw: null,
        startAt: far.date.utcIso,
        startOffsetMin: far.date.offsetMinutes,
      },
      {
        id: 4,
        sourceName: "Synthetic App",
        deviceHw: null,
        deviceSw: null,
        startAt: middle.date.utcIso,
        startOffsetMin: middle.date.offsetMinutes,
      },
    ]);
    expect(result.assignments.map((row) => row.deviceHw)).toEqual(["Watch5,9", "Watch5,9", "", ""]);
    expect(result.epochs.filter((epoch) => epoch.kind === "app")).toHaveLength(2);
  });

  test("B-D8 software changes create epoch OS-update events", () => {
    const result = deriveEpochs(fixtureRecords());
    expect(result.events).toEqual([
      {
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch7,5",
        day: "2026-04-05",
        kind: "os_update",
        detail: "11.0 → 11.1",
      },
    ]);
  });

  test("B-D8 interleaved older versions do not create events", () => {
    const versions = ["26.0.1", "26.1", "26.1.0", "11.5", "26.0.1", "26.2"];
    const records = versions.map((deviceSw, index): EpochInput => {
      const parsed = parseHealthKitDate(
        `2026-04-${String(index + 1).padStart(2, "0")} 12:00:00 +0900`,
      );
      if (!parsed.ok) throw new Error("invalid version test date");
      return {
        id: index + 1,
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch7,5",
        deviceSw,
        startAt: parsed.date.utcIso,
        startOffsetMin: parsed.date.offsetMinutes,
      };
    });

    expect(deriveEpochs(records).events).toEqual([
      {
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch7,5",
        day: "2026-04-02",
        kind: "os_update",
        detail: "26.0.1 → 26.1",
      },
      {
        sourceName: REPLACEMENT_SOURCE,
        deviceHw: "Watch7,5",
        day: "2026-04-06",
        kind: "os_update",
        detail: "26.1 → 26.2",
      },
    ]);
  });

  test("v1 derived tables replace v0 tables and epoch rebuild persists the result", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
    expect(columns("epochs")).toContain("days_present");
    expect(columns("metric_values")).toEqual([
      "metric",
      "epoch_id",
      "unit_day",
      "unit_kind",
      "value",
      "n",
      "usable",
    ]);
    expect(() => db.query("SELECT * FROM daily_metrics").all()).toThrow();

    db.prepare(
      `INSERT INTO imports (created_at, zip_name, zip_size, status)
       VALUES ('2026-04-06T00:00:00Z', 'synthetic.zip', 1, 'done')`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO records
         (type, source_name, start_at, end_at, start_offset_min, import_id, device_hw, device_sw)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    for (const record of fixtureRecords()) {
      insert.run(
        `fixture-${record.id}`,
        record.sourceName,
        record.startAt,
        record.startAt,
        record.startOffsetMin,
        record.deviceHw,
        record.deviceSw,
      );
    }
    const derived = rebuildEpochs(db);
    const expected = deriveEpochs(fixtureRecords());
    expect(derived.epochs).toEqual(expected.epochs);
    expect(derived.events).toEqual(expected.events);
    expect(derived.epochs).toHaveLength(2);
    expect(db.query("SELECT COUNT(*) AS count FROM epochs").get()).toEqual({ count: 2 });
    expect(db.query("SELECT kind, detail FROM epoch_events").all()).toEqual([
      { kind: "os_update", detail: "11.0 → 11.1" },
    ]);
    db.close();
  });
});
