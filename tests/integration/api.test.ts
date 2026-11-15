import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { type RecordSpec, renderExport, SLEEP_VALUE, spike, TYPE } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function app() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  ).run();
  databases.push(db);
  return createApp({ db });
}

describe("read API", () => {
  test("import history remains readable", async () => {
    const response = await app().request("/api/imports");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ zipName: "synthetic.zip", status: "done" }]);
  });

  test("B-R1 spike fixture has no sleep-derived as-of because it has no sleep records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-api-cause-"));
    const dbPath = join(dir, "fixture.db"),
      zipPath = join(dir, "fixture.zip");
    writeFileSync(
      zipPath,
      buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
    );
    let db = openDb(dbPath);
    try {
      db.close();
      await runImport(dbPath, zipPath);
      db = openDb(dbPath);
      expect(
        (db.query("SELECT COUNT(*) n FROM records WHERE type=?").get(TYPE.sleep) as { n: number })
          .n,
      ).toBe(0);
      expect((db.query("SELECT COUNT(*) n FROM metric_values").get() as { n: number }).n).toBe(0);
      const response = await createApp({ db }).request("/api/changes");
      expect(((await response.json()) as { asOfDay: string | null }).asOfDay).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("B-I9 synthetic import smoke completes within the two-minute budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-import-b-i9-"));
    const dbPath = join(dir, "fixture.db");
    const zipPath = join(dir, "fixture.zip");
    writeFileSync(
      zipPath,
      buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
    );
    try {
      const summary = await runImport(dbPath, zipPath);
      expect(summary.status).toBe("done");
      expect(summary.durationMs).toBeLessThan(120_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("B-R1/B-R3 fixture with post-night ExportDate populates v1 read routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-api-"));
    const dbPath = join(dir, "fixture.db"),
      zipPath = join(dir, "fixture.zip");
    const device =
      "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";
    const records: RecordSpec[] = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return {
        type: TYPE.sleep,
        sourceName: "Synthetic Watch",
        startDate: `2026-02-${day} 22:00:00 +0000`,
        endDate: `2026-02-${String(index + 2).padStart(2, "0")} 06:00:00 +0000`,
        value: SLEEP_VALUE.core,
        device,
      };
    });
    const xml = renderExport({ exportDate: "2026-02-21 08:00:00 +0000", records, workouts: [] });
    writeFileSync(zipPath, buildStoredZip([{ name: "apple_health_export/export.xml", data: xml }]));
    let db = openDb(dbPath);
    try {
      db.close();
      const summary = await runImport(dbPath, zipPath);
      expect(summary.inserted).toBeGreaterThan(0);
      expect(summary.asOfDay).toBe("2026-02-07");
      db = openDb(dbPath);
      expect(
        (db.query("SELECT COUNT(*) n FROM metric_values").get() as { n: number }).n,
      ).toBeGreaterThan(0);
      const api = createApp({ db });
      const changesRes = await api.request("/api/changes");
      expect(changesRes.status).toBe(200);
      const changes = (await changesRes.json()) as {
        hasImports: boolean;
        asOfDay: string | null;
        freshness: { asOfDay: string | null; lastImportAt: string | null };
        overnight: Array<{ metric: string; state: string }>;
        warmingNotice: { metric: string; current: number; target: number } | null;
        lastNight: { date: string } | null;
      };
      expect(changes.hasImports).toBe(true);
      expect(changes.asOfDay).toBe("2026-02-07");
      expect((await (await api.request("/api/imports")).json())[0]).toMatchObject({
        exportDate: "2026-02-21 08:00:00 +0000",
        asOfDay: changes.asOfDay,
      });
      expect(changes.freshness.asOfDay).toBe(changes.asOfDay);
      expect(changes.freshness.lastImportAt).not.toBeNull();
      expect(changes.warmingNotice).toMatchObject({ metric: "sleep_h", current: 7, target: 14 });
      expect(changes.overnight.map((row) => row.metric)).toEqual(["sleep_h", "deep_h", "rem_h"]);
      expect(changes.overnight.every((row) => row.state === "warming_up")).toBe(true);
      expect(changes.lastNight?.date).toBe("2026-02-07");

      const index = (await (await api.request("/api/metrics")).json()) as {
        metrics: Array<{ metric: string; hasData: boolean }>;
      };
      expect(index.metrics.length).toBeGreaterThan(0);
      const metric = index.metrics.find((entry) => entry.hasData)?.metric ?? "sleep_h";
      const series = (await (await api.request(`/api/metrics/${metric}?range=all`)).json()) as {
        range: string;
        units: unknown[];
      };
      expect(series.range).toBe("all");
      expect(series.units.length).toBeGreaterThan(0);
      const epoch = (await (await api.request("/api/epochs")).json()) as { epochs: unknown[] };
      expect(epoch.epochs.length).toBeGreaterThan(0);
      const unitDay = db
        .query("SELECT unit_day day FROM metric_values WHERE metric=? LIMIT 1")
        .get(metric) as { day: string };
      expect((await api.request(`/api/metrics/${metric}/units/${unitDay.day}`)).status).toBe(200);
      const nights = await api.request("/api/nights?from=2026-02-01&to=2026-02-10");
      expect(nights.status).toBe(200);
      const nightRows = (await nights.json()) as {
        nights: Array<{
          date: string;
          tzChange: boolean;
          asleepS: number;
          partialReason: string | null;
        }>;
      };
      expect(nightRows.nights.length).toBeGreaterThan(0);
      expect(nightRows.nights.at(-1)).toMatchObject({
        date: "2026-02-07",
        tzChange: false,
        partialReason: null,
      });
      expect((await api.request("/api/nights?from=2025-01-01&to=2026-02-06")).status).toBe(400);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
