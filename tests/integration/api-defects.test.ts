import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { type RecordSpec, renderExport, SLEEP_VALUE, TYPE } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  ).run();
  databases.push(db);
  const insertEpoch = db.prepare(
    `INSERT INTO epochs (id,source_name,device_hw,kind,first_day,last_day,days_present)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const insertValue = db.prepare(
    `INSERT INTO metric_values (metric,epoch_id,unit_day,unit_kind,value,n,usable)
     VALUES (?,?,?,'day',?,1,1)`,
  );
  return { db, api: createApp({ db }), insertEpoch, insertValue };
}

function addEpoch(
  insert: ReturnType<typeof setup>["insertEpoch"],
  id: number,
  source: string,
  hardware: string,
  kind: "watch" | "phone" | "app" | "other",
  firstDay: string,
) {
  insert.run(id, source, hardware, kind, firstDay, "2026-02-28", 28);
}

function addSteps(
  insert: ReturnType<typeof setup>["insertValue"],
  epochId: number,
  days: string[],
) {
  for (const day of days) insert.run("steps", epochId, day, epochId * 100 + days.indexOf(day));
}

function sixDaysFrom(start: string) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index * 4);
    return date.toISOString().slice(0, 10);
  });
}

describe("API regression fixes from UI integration", () => {
  test("B-D5 / API seam identifies the stint ending before seam day", async () => {
    const { api, insertEpoch, insertValue, db } = setup();
    addEpoch(insertEpoch, 10, "Old watch", "Watch5,1", "watch", "2026-01-01");
    addEpoch(insertEpoch, 20, "New watch", "Watch7,5", "watch", "2026-02-01");
    db.prepare(
      `INSERT INTO stints (metric,epoch_id,start_day,end_day) VALUES
       ('steps',10,'2026-01-01','2026-01-31'),('steps',20,'2026-02-01',NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO seam_steps (metric,seam_day,kind,value,n_old,n_new)
       VALUES ('steps','2026-02-01','step',10,7,7)`,
    ).run();
    insertValue.run("sleep_h", 10, "2026-02-07", 7);

    const response = await api.request("/api/metrics/steps?range=all");
    const series = (await response.json()) as {
      seams: Array<{ fromEpochId: number; toEpochId: number }>;
    };
    expect(series.seams).toMatchObject([{ fromEpochId: 10, toEpochId: 20 }]);
  });

  test("B-D2b / API epoch label uses source name and preserves hardware", async () => {
    const { api, db, insertEpoch } = setup();
    addEpoch(insertEpoch, 1, "Manual Sleep App", "", "app", "2026-01-01");
    db.prepare(
      `INSERT INTO metric_values (metric,epoch_id,unit_day,unit_kind,value,n,usable)
       VALUES ('sleep_h',1,'2026-01-01','night',7,1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO stints (id,metric,epoch_id,start_day,end_day)
       VALUES (1,'sleep_h',1,'2026-01-01',NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO findings (metric,state,asof_day,stint_id)
       VALUES ('sleep_h','warming_up','2026-01-01',1)`,
    ).run();

    const response = await api.request("/api/epochs");
    const payload = (await response.json()) as {
      epochs: Array<{ label: string; sourceName: string; deviceHw: string }>;
    };
    expect(payload.epochs[0]).toMatchObject({
      label: "Manual Sleep App",
      sourceName: "Manual Sleep App",
      deviceHw: "",
    });
    const changesResponse = await api.request("/api/changes");
    const changes = (await changesResponse.json()) as {
      overnight: Array<{ metric: string; epochLabel: string | null }>;
    };
    expect(changes.overnight).toContainEqual(
      expect.objectContaining({ metric: "sleep_h", epochLabel: "Manual Sleep App" }),
    );
    const seriesResponse = await api.request("/api/metrics/sleep_h?range=all");
    const series = (await seriesResponse.json()) as {
      epochs: Array<{ label: string; deviceHw: string }>;
    };
    expect(series.epochs[0]).toMatchObject({ label: "Manual Sleep App", deviceHw: "" });
  });

  test("B-D3 / API epochs include only recorded metric roles", async () => {
    const { api, insertEpoch, insertValue } = setup();
    addEpoch(insertEpoch, 1, "Watch", "Watch7,5", "watch", "2026-01-01");
    insertValue.run("sleep_h", 1, "2026-02-07", 7);

    const response = await api.request("/api/epochs");
    const payload = (await response.json()) as {
      epochs: Array<{ metrics: Array<{ metric: string }> }>;
    };
    expect(payload.epochs[0]?.metrics.map((metric) => metric.metric)).toEqual(["sleep_h"]);
  });

  test("B-D3 / API colors follow epoch start order and all-minor epochs have no color", async () => {
    const { api, insertEpoch, insertValue } = setup();
    addEpoch(insertEpoch, 8, "Later", "Watch8,1", "watch", "2026-01-02");
    addEpoch(insertEpoch, 30, "Earlier", "Watch7,5", "watch", "2026-01-01");
    addEpoch(insertEpoch, 99, "Sparse", "", "app", "2026-01-03");
    addEpoch(insertEpoch, 101, "Other metric", "iPhone17,1", "phone", "2026-01-04");
    addSteps(insertValue, 8, sixDaysFrom("2026-01-01"));
    addSteps(insertValue, 30, sixDaysFrom("2026-01-02"));
    addSteps(insertValue, 99, ["2026-01-05"]);
    addSteps(insertValue, 101, ["2026-01-06"]);
    for (const day of sixDaysFrom("2026-01-01")) insertValue.run("sleep_h", 101, day, 7);

    const response = await api.request("/api/metrics/steps?range=all");
    const series = (await response.json()) as {
      epochs: Array<{ id: number; colorIndex: number | null; minor: boolean }>;
    };
    expect(series.epochs).toEqual([
      expect.objectContaining({ id: 30, colorIndex: 0, minor: false }),
      expect.objectContaining({ id: 8, colorIndex: 1, minor: false }),
      expect.objectContaining({ id: 99, colorIndex: null, minor: true }),
      expect.objectContaining({ id: 101, colorIndex: 2, minor: true }),
    ]);
  });

  test("B-D3 / API series marks sparse metric epochs minor but keeps non-primary candidates", async () => {
    const { api, insertEpoch, insertValue, db } = setup();
    addEpoch(insertEpoch, 1, "Primary", "Watch7,5", "watch", "2026-01-01");
    addEpoch(insertEpoch, 2, "Candidate", "iPhone17,1", "phone", "2026-01-01");
    addEpoch(insertEpoch, 3, "Sparse app", "", "app", "2026-01-01");
    addSteps(insertValue, 1, sixDaysFrom("2026-01-01"));
    addSteps(insertValue, 2, sixDaysFrom("2026-01-01"));
    addSteps(insertValue, 3, ["2026-01-09"]);
    db.prepare(
      `INSERT INTO stints (metric,epoch_id,start_day,end_day)
       VALUES ('steps',1,'2026-01-01',NULL)`,
    ).run();

    const response = await api.request("/api/metrics/steps?range=180d");
    const series = (await response.json()) as {
      epochs: Array<{ id: number; minor: boolean }>;
    };
    expect(series.epochs).toEqual([
      expect.objectContaining({ id: 1, minor: false }),
      expect.objectContaining({ id: 2, minor: false }),
      expect.objectContaining({ id: 3, minor: true }),
    ]);
  });

  test("B-F4 SpO2 is derived in percent so its 1-point floor applies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-spo2-percent-"));
    const dbPath = join(dir, "fixture.db"),
      zipPath = join(dir, "fixture.zip");
    const device =
      "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";
    const records: RecordSpec[] = [
      {
        type: TYPE.sleep,
        sourceName: "Synthetic Watch",
        startDate: "2026-02-01 22:00:00 +0000",
        endDate: "2026-02-02 06:00:00 +0000",
        value: SLEEP_VALUE.core,
        device,
      },
      ...[0.92, 0.94, 0.96].map((value, index) => ({
        type: "HKQuantityTypeIdentifierOxygenSaturation",
        sourceName: "Synthetic Watch",
        startDate: `2026-02-02 01:0${index}:00 +0000`,
        endDate: `2026-02-02 01:0${index}:00 +0000`,
        value: String(value),
        unit: "%",
        device,
      })),
    ];
    writeFileSync(
      zipPath,
      buildStoredZip([
        {
          name: "apple_health_export/export.xml",
          data: renderExport({
            exportDate: "2026-02-03 08:00:00 +0000",
            records,
            workouts: [],
          }),
        },
      ]),
    );
    let db = openDb(dbPath);
    try {
      db.close();
      await runImport(dbPath, zipPath);
      db = openDb(dbPath);
      const value = db.query("SELECT value FROM metric_values WHERE metric='spo2'").get() as {
        value: number;
      };
      expect(value.value).toBe(94);
      const api = createApp({ db });
      const series = (await (await api.request("/api/metrics/spo2?range=all")).json()) as {
        units: Array<{ value: number }>;
      };
      expect(series.units[0]?.value).toBe(94);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("B-R range limits metric seams and primary-epoch OS updates", async () => {
    const { api, db, insertEpoch, insertValue } = setup();
    addEpoch(insertEpoch, 1, "Old watch", "Watch5,1", "watch", "2025-11-01");
    addEpoch(insertEpoch, 2, "Current watch", "Watch7,5", "watch", "2025-12-01");
    db.prepare(
      `INSERT INTO stints (metric,epoch_id,start_day,end_day) VALUES
       ('steps',1,'2025-11-01','2025-11-30'),('steps',2,'2025-12-01',NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO seam_steps (metric,seam_day,kind,value,n_old,n_new) VALUES
       ('steps','2025-11-30','step',1,7,7),('steps','2025-12-01','step',2,7,7)`,
    ).run();
    db.prepare(
      `INSERT INTO epoch_events (epoch_id,day,kind,detail) VALUES
       (1,'2025-12-02','os_update','26.0 → 26.1'),
       (2,'2025-12-03','os_update','26.1 → 26.2'),
       (2,'2025-09-01','os_update','25.0 → 25.1')`,
    ).run();
    insertValue.run("sleep_h", 2, "2026-02-28", 7);
    insertValue.run("steps", 2, "2026-02-28", 1000);

    const response = await api.request("/api/metrics/steps?range=90d");
    const series = (await response.json()) as {
      seams: Array<{ seamDay: string }>;
      osUpdates: Array<{ epochId: number; day: string; fromSw: string | null; toSw: string }>;
    };
    expect(series.seams.map((seam) => seam.seamDay)).toEqual(["2025-12-01"]);
    expect(series.osUpdates).toEqual([
      { epochId: 2, day: "2025-12-03", fromSw: "26.1", toSw: "26.2" },
    ]);
  });

  test("B-F2 epoch baseline state belongs only to the current primary stint", async () => {
    const { api, db, insertEpoch, insertValue } = setup();
    addEpoch(insertEpoch, 1, "Old watch", "Watch5,1", "watch", "2025-11-01");
    addEpoch(insertEpoch, 2, "Current watch", "Watch7,5", "watch", "2025-12-01");
    db.prepare(
      `INSERT INTO metric_values (metric,epoch_id,unit_day,unit_kind,value,n,usable)
       VALUES ('steps',1,'2025-11-20','day',1000,1,1),
              ('sleep_h',2,'2026-02-28','night',7,1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO stints (id,metric,epoch_id,start_day,end_day) VALUES
       (1,'steps',1,'2025-11-01','2025-11-30'),(2,'steps',2,'2025-12-01',NULL),
       (3,'sleep_h',2,'2025-12-01',NULL)`,
    ).run();
    for (let index = 0; index < 22; index++) {
      const date = new Date("2026-01-01T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + index);
      insertValue.run("steps", 2, date.toISOString().slice(0, 10), 1000);
    }
    db.prepare(
      `INSERT INTO findings (metric,state,asof_day,stint_id,z,severity,confidence,recent,baseline,
         k_outside,checks_json)
       VALUES ('steps','computed','2026-02-28',2,0,'within','high',1000,1000,0,'[]')`,
    ).run();

    const payload = (await (await api.request("/api/epochs")).json()) as {
      epochs: Array<{
        id: number;
        metrics: Array<{ metric: string; role: string; baselineState: string | null }>;
      }>;
    };
    expect(payload.epochs.find((epoch) => epoch.id === 1)?.metrics).toContainEqual(
      expect.objectContaining({ metric: "steps", role: "minor", baselineState: null }),
    );
    expect(payload.epochs.find((epoch) => epoch.id === 2)?.metrics).toContainEqual(
      expect.objectContaining({ metric: "steps", role: "primary", baselineState: "full" }),
    );
    const changes = (await (await api.request("/api/changes")).json()) as {
      daytime: Array<{ metric: string }>;
    };
    expect(changes.daytime.some((row) => row.metric === "steps")).toBe(false);
  });

  test("B-A4 / API all-range weekly buckets retain each contributing epoch", async () => {
    const { api, insertEpoch, insertValue } = setup();
    addEpoch(insertEpoch, 1, "Watch", "Watch7,5", "watch", "2026-01-01");
    addEpoch(insertEpoch, 2, "Phone", "iPhone17,1", "phone", "2026-01-01");
    insertValue.run("steps", 1, "2026-01-05", 100);
    insertValue.run("steps", 2, "2026-01-06", 200);
    insertValue.run("sleep_h", 1, "2026-01-06", 7);

    const response = await api.request("/api/metrics/steps?range=all");
    const series = (await response.json()) as {
      units: Array<{ day: string; epochId: number; value: number }>;
    };
    expect(series.units).toEqual([
      expect.objectContaining({ day: "2026-01-05", epochId: 1, value: 100 }),
      expect.objectContaining({ day: "2026-01-05", epochId: 2, value: 200 }),
    ]);
    expect(series.units.every((unit) => unit.epochId !== 0)).toBe(true);
  });
});
