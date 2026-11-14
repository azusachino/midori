import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { dedup, type Fixture, general } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import { runImport } from "./import";

const tmp = resolve(import.meta.dir, "../../.tmp-import-test");
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
    const backupDir = `${tmp}/backups-${seq}`;
    const archiveDir = `${tmp}/archive-${seq}`;
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
});
