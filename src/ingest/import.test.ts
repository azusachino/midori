import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { dedup, type Fixture, general } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import { runImport } from "./import";

const tmp = resolve(import.meta.dir, "../../.tmp-import-test");
// Run-unique: archive/backup dirs must not collide with a previous run's
// leftovers (an archived cli.zip from run N breaks run N+1's assertions).
const runId = randomUUID().slice(0, 8);
let seq = 0;

function freshDb(): string {
  const path = `${tmp}/db-${seq++}.sqlite`;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${path}${suffix}`);
    } catch {
      // absent — fine
    }
  }
  const db = openDb(path);
  db.close();
  return path;
}

async function fixtureZip(fx: Fixture, name: string): Promise<string> {
  const path = `${tmp}/${name}.zip`;
  await Bun.write(path, buildStoredZip([{ name: "apple_health_export/export.xml", data: fx.xml }]));
  return path;
}

const zips: string[] = [];

beforeAll(async () => {
  await Bun.write(`${tmp}/.keep`, "");
});

afterAll(async () => {
  for (const z of zips) {
    try {
      await Bun.file(z).delete();
    } catch {
      // already moved to the archive dir by the CLI under test — fine
    }
  }
});

describe("runImport", () => {
  const fx: Fixture = general;
  let dbPath: string;
  let zipPath: string;

  beforeAll(async () => {
    dbPath = freshDb();
    zipPath = await fixtureZip(fx, "general");
    zips.push(zipPath);
  });

  test("imports fixture zip end-to-end", async () => {
    const summary = await runImport(dbPath, zipPath);
    const malformed = fx.expected.records.filter((r) => r.malformed !== null).length;
    expect(summary.status).toBe("done");
    expect(summary.attempted).toBe(fx.expected.recordCount - malformed);
    expect(summary.inserted).toBe(fx.expected.recordCount - malformed);
    expect(summary.deduped).toBe(0);
    expect(summary.malformedDates).toBe(malformed);
    expect(summary.exportDate).toBe(fx.expected.exportDate);

    const db = new Database(dbPath);
    try {
      const imp = db.query("SELECT * FROM imports WHERE id = ?").get(summary.importId) as Record<
        string,
        unknown
      >;
      expect(imp.status).toBe("done");
      expect(imp.records_seen).toBe(fx.expected.recordCount);
      expect(imp.records_inserted).toBe(fx.expected.recordCount - malformed);
      expect(imp.export_date).toBe(fx.expected.exportDate);

      const stored = db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number };
      expect(stored.n).toBe(fx.expected.recordCount - malformed);

      const sources = db
        .query("SELECT name, record_count FROM sources ORDER BY name")
        .all() as Array<{ name: string; record_count: number }>;
      expect(sources.length).toBeGreaterThanOrEqual(2);
      const total = sources.reduce((acc, s) => acc + s.record_count, 0);
      expect(total).toBe(fx.expected.recordCount - malformed);
    } finally {
      db.close();
    }
  });

  test("second import is a no-op: 0 new rows, everything deduped", async () => {
    const summary = await runImport(dbPath, zipPath);
    expect(summary.inserted).toBe(0);
    expect(summary.deduped).toBe(summary.attempted);
    expect(summary.malformedDates).toBe(
      fx.expected.records.filter((r) => r.malformed !== null).length,
    );

    const db = new Database(dbPath);
    try {
      const stored = db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number };
      expect(stored.n).toBe(fx.expected.recordCount - 1);
      const imports = db.query("SELECT COUNT(*) AS n FROM imports").get() as { n: number };
      expect(imports.n).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe("runImport: capture backfill", () => {
  test("B-I12 re-import fills device columns on pre-v1 rows", async () => {
    const dbPath = freshDb();
    const zipPath = await fixtureZip(general, "capture-backfill");
    zips.push(zipPath);
    const first = await runImport(dbPath, zipPath);
    const db = new Database(dbPath);
    try {
      db.run("UPDATE records SET device_hw = NULL, device_sw = NULL, meta_json = NULL");
    } finally {
      db.close();
    }

    const second = await runImport(dbPath, zipPath);
    expect(second.inserted).toBe(0);
    expect(second.deduped).toBe(first.attempted);
    const check = new Database(dbPath);
    try {
      const device = check
        .query("SELECT device_hw, device_sw FROM records WHERE type = ? LIMIT 1")
        .get("HKQuantityTypeIdentifierHeartRate") as { device_hw: string; device_sw: string };
      expect(device).toEqual({ device_hw: "Watch7,5", device_sw: "26.1" });
      const metadata = check
        .query("SELECT meta_json FROM records WHERE type = ? AND meta_json IS NOT NULL LIMIT 1")
        .get("HKCategoryTypeIdentifierSleepAnalysis") as { meta_json: string };
      expect(JSON.parse(metadata.meta_json)).toHaveProperty("HKTimeZone", "Asia/Tokyo");
    } finally {
      check.close();
    }
  });
});

describe("runImport: dedup corpus", () => {
  test("byte-identical and numerically-equal duplicates collapse on first import", async () => {
    const dbPath = freshDb();
    const zipPath = await fixtureZip(dedup, "dedup");
    zips.push(zipPath);
    const summary = await runImport(dbPath, zipPath);

    const exactDup = dedup.expected.records.filter((r) => r.exactDuplicateOf !== null).length;
    const numericDup = dedup.expected.records.filter((r) => r.numericDuplicateOf !== null).length;
    expect(summary.deduped).toBe(exactDup + numericDup);
    expect(summary.inserted).toBe(summary.attempted - exactDup - numericDup);
  });
});

describe("CLI", () => {
  test("`bun src/cli.ts import` runs end-to-end and prints JSON", async () => {
    const dbPath = freshDb();
    const zipPath = await fixtureZip(general, "cli");
    zips.push(zipPath);
    const backupDir = `${tmp}/backups-${runId}-${seq}`;
    const archiveDir = `${tmp}/archive-${runId}-${seq}`;
    seq += 1;
    const proc = Bun.spawnSync([
      "bun",
      "src/cli.ts",
      "import",
      zipPath,
      "--db",
      dbPath,
      "--backup-dir",
      backupDir,
      "--archive-dir",
      archiveDir,
    ]);
    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(proc.stdout.toString()) as {
      status: string;
      inserted: number;
      backupPath: string | null;
      archivedPath: string | null;
    };
    expect(out.status).toBe("done");
    expect(out.inserted).toBeGreaterThan(0);
    expect(out.backupPath).toMatch(/midori-\d{8}-\d{6}\.db$/);
    expect(await Bun.file(out.backupPath ?? "").exists()).toBeTrue();
    expect(out.archivedPath).toBe(`${archiveDir}/cli.zip`);
    expect(await Bun.file(out.archivedPath ?? "").exists()).toBeTrue();
    expect(await Bun.file(zipPath).exists()).toBeFalse();

    const zipPath2 = await fixtureZip(general, "cli-keep");
    zips.push(zipPath2);
    const proc2 = Bun.spawnSync([
      "bun",
      "src/cli.ts",
      "import",
      zipPath2,
      "--db",
      dbPath,
      "--backup-dir",
      backupDir,
      "--keep-zip",
    ]);
    expect(proc2.exitCode).toBe(0);
    const out2 = JSON.parse(proc2.stdout.toString()) as { archivedPath: string | null };
    expect(out2.archivedPath).toBeNull();
    expect(await Bun.file(zipPath2).exists()).toBeTrue();
  });

  test("`bun src/cli.ts backup` snapshots + prunes without an import", async () => {
    // Self-contained: build a db through the library, then exercise the CLI.
    const dbPath2 = freshDb();
    const zipPath0 = await fixtureZip(general, "cli-backup");
    zips.push(zipPath0);
    const backupDir = `${tmp}/backups-${runId}-${seq}`;
    seq += 1;
    const imp = await runImport(dbPath2, zipPath0);
    expect(imp.status).toBe("done");
    const proc = Bun.spawnSync([
      "bun",
      "src/cli.ts",
      "backup",
      "--db",
      dbPath2,
      "--backup-dir",
      backupDir,
    ]);
    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(proc.stdout.toString()) as {
      ok: boolean;
      snapshotPath: string;
      bytes: number;
      pruned: number;
    };
    expect(out.ok).toBe(true);
    expect(out.snapshotPath).toMatch(/midori-\d{8}-\d{6}(-\d+)?\.db$/);
    expect(out.bytes).toBeGreaterThan(0);
    expect(await Bun.file(out.snapshotPath).exists()).toBeTrue();
    expect(out.pruned).toBe(0); // fresh dir holds only this run's snapshot
  });

  test("`bun src/cli.ts backup` rejects a non-positive retention", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "backup", "--retention-days", "0"]);
    expect(proc.exitCode).not.toBe(0);
    expect(proc.exitCode).not.toBe(0);
  });
});
