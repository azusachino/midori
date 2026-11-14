import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { openDb } from "../db/db";
import {
  archiveZip,
  backupDatabase,
  checkIntegrity,
  pruneBackups,
  restoreSnapshot,
  snapshotName,
} from "./backup";

/**
 * T7 tests. All scratch files live under `src/backup/.tmp-t7/` (contents match
 * gitignored patterns: *.db, *.db-wal, *.db-shm, *.zip) — `data/` is never touched.
 */

const TMP = `${import.meta.dir}/.tmp-t7`;
const DAY_MS = 86_400_000;

function caseDir(name: string): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Seed a migrated database with `rows` heart-rate records. */
function seedDb(dbPath: string, rows: number): string {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  try {
    db.run(
      `INSERT INTO imports (created_at, zip_name, zip_size, status)
       VALUES ('2026-11-14T00:00:00.000Z', 'export.zip', 66, 'done')`,
    );
    const stmt = db.prepare(
      `INSERT INTO records (type, source_name, unit, start_at, end_at, value, import_id)
       VALUES ('HKQuantityTypeIdentifierHeartRate', 'ハルのApple Watch', 'count/min', ?, ?, ?, 1)`,
    );
    for (let i = 0; i < rows; i++) {
      stmt.run(`2026-11-01T0${i}:00:00.000Z`, `2026-11-01T0${i}:01:00.000Z`, 60 + i);
    }
  } finally {
    db.close();
  }
  return dbPath;
}

function countRecords(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query("SELECT COUNT(*) AS n FROM records").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("snapshotName", () => {
  test("pins the UTC timestamp shape", () => {
    expect(snapshotName(new Date("2026-11-14T07:05:09.123Z"))).toBe("midori-20261114-070509.db");
    expect(snapshotName(new Date("2026-01-02T03:04:05.000Z"))).toBe("midori-20260102-030405.db");
  });
});

describe("backupDatabase", () => {
  test("writes a checkpointed snapshot whose integrity_check is ok", () => {
    const dir = caseDir("backup");
    const live = seedDb(join(dir, "live.db"), 3);
    const backupDir = join(dir, "backups");
    const now = new Date("2026-11-14T12:00:00.000Z");

    const result = backupDatabase(live, { backupDir, now });

    expect(basename(result.snapshotPath)).toBe("midori-20261114-120000.db");
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(result.snapshotPath)).toBe(true);
    expect(countRecords(result.snapshotPath)).toBe(3);
    expect(() => checkIntegrity(result.snapshotPath)).not.toThrow();

    // The checkpoint truncated the source WAL, so the snapshot needed no -wal of its own.
    expect(existsSync(`${result.snapshotPath}-wal`)).toBe(false);
    const liveWal = `${live}-wal`;
    expect(existsSync(liveWal) ? statSync(liveWal).size : 0).toBe(0);
  });

  test("same-second re-backup allocates a suffixed snapshot instead of overwriting", () => {
    const dir = caseDir("backup-collision");
    const live = seedDb(join(dir, "live.db"), 1);
    const backupDir = join(dir, "backups");
    const now = new Date("2026-11-14T12:00:00.000Z");

    const first = backupDatabase(live, { backupDir, now });
    expect(first.snapshotPath.endsWith("midori-20261114-120000.db")).toBe(true);
    const second = backupDatabase(live, { backupDir, now });
    expect(second.snapshotPath.endsWith("midori-20261114-120000-1.db")).toBe(true);
    // Both survive: the second backup never clobbered the first.
    expect(existsSync(first.snapshotPath)).toBe(true);
    expect(existsSync(second.snapshotPath)).toBe(true);
    checkIntegrity(second.snapshotPath);
  });

  test("throws for a missing database", () => {
    const dir = caseDir("backup-missing");
    expect(() =>
      backupDatabase(join(dir, "absent.db"), { backupDir: join(dir, "backups") }),
    ).toThrow(/no database at/);
  });
});

describe("restoreSnapshot", () => {
  test("backup → restore yields a readable database", () => {
    const dir = caseDir("roundtrip");
    const live = seedDb(join(dir, "live.db"), 3);
    const { snapshotPath } = backupDatabase(live, {
      backupDir: join(dir, "backups"),
      now: new Date("2026-11-14T12:00:00.000Z"),
    });

    const targetPath = join(dir, "restored", "midori.db");
    const result = restoreSnapshot(snapshotPath, targetPath);

    expect(result.targetPath).toBe(targetPath);
    expect(countRecords(targetPath)).toBe(3);
    expect(() => checkIntegrity(targetPath)).not.toThrow();
    expect(existsSync(`${targetPath}.restore-tmp`)).toBe(false);
  });

  test("removes stale -wal/-shm sidecars and replaces contents", () => {
    const dir = caseDir("sidecars");
    const live = seedDb(join(dir, "live.db"), 3);
    const { snapshotPath } = backupDatabase(live, {
      backupDir: join(dir, "backups"),
      now: new Date("2026-11-14T12:00:00.000Z"),
    });

    const targetPath = join(dir, "target", "midori.db");
    seedDb(targetPath, 1);
    writeFileSync(`${targetPath}-wal`, "stale write-ahead log");
    writeFileSync(`${targetPath}-shm`, "stale shared-memory index");

    restoreSnapshot(snapshotPath, targetPath);

    expect(existsSync(`${targetPath}-wal`)).toBe(false);
    expect(existsSync(`${targetPath}-shm`)).toBe(false);
    expect(countRecords(targetPath)).toBe(3);
  });

  test("corrupted snapshot fails integrity_check and leaves the target untouched", async () => {
    const dir = caseDir("corrupt");
    const live = seedDb(join(dir, "live.db"), 3);
    const { snapshotPath } = backupDatabase(live, {
      backupDir: join(dir, "backups"),
      now: new Date("2026-11-14T12:00:00.000Z"),
    });

    const bytes = new Uint8Array(await Bun.file(snapshotPath).arrayBuffer());
    bytes.fill(0xff, 100, Math.min(4000, bytes.length));
    const corruptedPath = join(dir, "corrupted.db");
    writeFileSync(corruptedPath, bytes);

    expect(() => checkIntegrity(corruptedPath)).toThrow(/integrity_check/);
    const targetPath = join(dir, "target", "midori.db");
    expect(() => restoreSnapshot(corruptedPath, targetPath)).toThrow(/integrity_check/);
    expect(existsSync(targetPath)).toBe(false);
  });
});

describe("pruneBackups", () => {
  test("keeps the cutoff boundary, deletes one second older, keeps newer", () => {
    const dir = caseDir("retention");
    const live = seedDb(join(dir, "live.db"), 1);
    const backupDir = join(dir, "backups");
    const now = new Date("2026-11-14T12:00:00.000Z");
    const cutoffMs = now.getTime() - 30 * DAY_MS;

    const atBoundary = backupDatabase(live, { backupDir, now: new Date(cutoffMs) });
    const oneSecondOlder = backupDatabase(live, {
      backupDir,
      now: new Date(cutoffMs - 1000),
    });
    const newer = backupDatabase(live, { backupDir, now: new Date(now.getTime() - 1000) });

    utimesSync(atBoundary.snapshotPath, new Date(cutoffMs), new Date(cutoffMs));
    utimesSync(oneSecondOlder.snapshotPath, new Date(cutoffMs - 1000), new Date(cutoffMs - 1000));
    utimesSync(newer.snapshotPath, new Date(now.getTime()), new Date(now.getTime()));

    // retentionDays omitted on purpose: the 30-day default must do this.
    const deleted = pruneBackups(backupDir, { now });

    expect(deleted).toEqual([basename(oneSecondOlder.snapshotPath)]);
    expect(existsSync(oneSecondOlder.snapshotPath)).toBe(false);
    expect(existsSync(atBoundary.snapshotPath)).toBe(true);
    expect(existsSync(newer.snapshotPath)).toBe(true);
  });

  test("leaves files that are not snapshots alone", () => {
    const dir = caseDir("retention-foreign");
    const now = new Date("2026-11-14T12:00:00.000Z");
    const foreign = join(dir, "notes.txt");
    writeFileSync(foreign, "not a snapshot");
    const old = new Date(now.getTime() - 365 * DAY_MS);
    utimesSync(foreign, old, old);

    expect(pruneBackups(dir, { now })).toEqual([]);
    expect(existsSync(foreign)).toBe(true);
    expect(readdirSync(dir)).toEqual(["notes.txt"]);
  });

  test("returns [] for a missing backup dir", () => {
    const dir = caseDir("retention-missing");
    expect(
      pruneBackups(join(dir, "absent"), { now: new Date("2026-11-14T12:00:00.000Z") }),
    ).toEqual([]);
  });
});

describe("archiveZip", () => {
  test("moves the zip into the archive dir, creating it if missing", async () => {
    const dir = caseDir("archive-case");
    const zipPath = join(dir, "export.zip");
    await Bun.write(zipPath, "PK\u0003\u0004 not a real zip, contents are irrelevant to a move");
    const archiveDir = join(dir, "archive");

    const archivedPath = archiveZip(zipPath, { archiveDir });

    expect(archivedPath).toBe(join(archiveDir, "export.zip"));
    expect(existsSync(zipPath)).toBe(false);
    expect(existsSync(archivedPath)).toBe(true);
    expect(await Bun.file(archivedPath).text()).toContain("not a real zip");
  });

  test("does not clobber an already archived zip of the same name", async () => {
    const dir = caseDir("archive-collision");
    const archiveDir = join(dir, "archive");
    await Bun.write(join(dir, "export.zip"), "first");
    const first = archiveZip(join(dir, "export.zip"), { archiveDir });
    await Bun.write(join(dir, "export.zip"), "second");

    const second = archiveZip(join(dir, "export.zip"), { archiveDir });

    expect(first).toBe(join(archiveDir, "export.zip"));
    expect(second).toBe(join(archiveDir, "export-1.zip"));
    expect(await Bun.file(first).text()).toBe("first");
    expect(await Bun.file(second).text()).toBe("second");
  });
});
