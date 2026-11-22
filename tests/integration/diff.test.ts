import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { derive } from "../../src/stats/derive";
import { type RecordSpec, renderExport, SLEEP_VALUE, TYPE } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

const dirs: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEVICE =
  "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";

function sleepRecords(nights: number, startDay = 1): RecordSpec[] {
  return Array.from({ length: nights }, (_, index) => {
    const day = String(startDay + index).padStart(2, "0");
    const next = String(startDay + index + 1).padStart(2, "0");
    return {
      type: TYPE.sleep,
      sourceName: "Synthetic Watch",
      startDate: `2026-02-${day} 22:00:00 +0000`,
      endDate: `2026-02-${next} 06:00:00 +0000`,
      value: SLEEP_VALUE.core,
      device: DEVICE,
    };
  });
}

function writeExport(dir: string, name: string, records: RecordSpec[]): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    buildStoredZip([
      {
        name: "apple_health_export/export.xml",
        data: renderExport({ exportDate: "2026-02-21 08:00:00 +0000", records, workouts: [] }),
      },
    ]),
  );
  return path;
}

function snapshotCount(db: Database): number {
  return Number((db.query("SELECT COUNT(*) AS n FROM finding_snapshots").get() as { n: number }).n);
}

describe("B-I13 import snapshots", () => {
  test("each done import writes a snapshot; a failed derive writes none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-diff-"));
    dirs.push(dir);
    const dbPath = join(dir, "fixture.db");
    const first = writeExport(dir, "first.zip", sleepRecords(7));
    const second = writeExport(dir, "second.zip", sleepRecords(14));

    const firstSummary = await runImport(dbPath, first);
    const secondSummary = await runImport(dbPath, second);
    expect(firstSummary.status).toBe("done");
    expect(secondSummary.status).toBe("done");

    const db = new Database(dbPath);
    databases.push(db);
    const findings = Number(
      (db.query("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n,
    );
    expect(findings).toBeGreaterThan(0);
    expect(
      db
        .query(
          `SELECT import_id AS importId, asof_day AS asofDay FROM finding_snapshots
           WHERE import_id = ? ORDER BY metric LIMIT 1`,
        )
        .get(secondSummary.importId),
    ).toEqual({ importId: 2, asofDay: "2026-02-14" });
    expect(snapshotCount(db)).toBe(findings * 2);

    // A rollback after the snapshot stage leaves no rows for the failed import.
    db.run(
      `INSERT INTO imports (id, created_at, zip_name, zip_size, status) VALUES (4, '2026-11-01T00:00:00Z', 'failed.zip', 1, 'deriving')`,
    );
    expect(() =>
      derive(db, {
        importId: 4,
        afterStage: (stage) => {
          if (stage === "findings") throw new Error("injected failure");
        },
      }),
    ).toThrow("injected failure");
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM finding_snapshots WHERE import_id = 4").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(snapshotCount(db)).toBe(findings * 2);
  });
});

describe("B-F15 import diff over REST", () => {
  test("first import has no diff; the next import diffs against it; duplicates are guarded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-diff-rest-"));
    dirs.push(dir);
    const dbPath = join(dir, "fixture.db");
    const first = writeExport(dir, "first.zip", sleepRecords(7));
    const second = writeExport(dir, "second.zip", sleepRecords(14));

    await runImport(dbPath, first);
    const db = openDb(dbPath);
    databases.push(db);
    const app = createApp({ db });
    const firstDiff = await app.request("/api/imports/1/diff");
    expect(firstDiff.status).toBe(200);
    expect(await firstDiff.json()).toEqual({ diff: null });
    expect((await app.request("/api/imports/99/diff")).status).toBe(404);

    await runImport(dbPath, second);
    const res = await app.request("/api/imports/2/diff");
    expect(res.status).toBe(200);
    const { diff } = (await res.json()) as {
      diff: {
        fromImportId: number;
        toImportId: number;
        fromAsOfDay: string;
        toAsOfDay: string;
        unchangedCount: number;
        items: Array<{ metric: string; kind: string; classification: string }>;
      } | null;
    };
    expect(diff).toMatchObject({
      fromImportId: 1,
      toImportId: 2,
      fromAsOfDay: "2026-02-07",
      toAsOfDay: "2026-02-14",
    });
    expect(diff?.items).toContainEqual(
      expect.objectContaining({
        metric: "sleep_h",
        kind: "overnight",
        classification: "baseline_ready",
      }),
    );

    // B-I3: re-importing the same zip reaches the same as-of, so its own diff is null...
    await runImport(dbPath, second);
    expect(await (await app.request("/api/imports/3/diff")).json()).toEqual({ diff: null });
    // ...while Changes still diffs the duplicate import against the prior earlier as-of.
    const changes = (await (await app.request("/api/changes")).json()) as {
      sinceLastImport: { fromImportId: number; toImportId: number } | null;
      recentNotes: unknown[];
    };
    expect(changes.sinceLastImport).toMatchObject({ fromImportId: 1, toImportId: 3 });
    expect(changes.recentNotes).toEqual([]);
  });
});
