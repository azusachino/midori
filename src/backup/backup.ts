import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { openDb } from "../db/db";

/**
 * Local backup + retention (T7).
 *
 * midori owns its own backups (docs/design.md, "Backups are owned by midori"):
 * a WAL-checkpointed `VACUUM INTO` snapshot, age-based retention, imported zips
 * archived, and a restore path that proves the snapshot is readable. Every
 * failure throws an `Error` with the paths involved — a backup that cannot be
 * verified is deleted rather than left behind looking healthy, and a restore
 * either replaces the target completely or leaves it untouched.
 *
 * Clock injection is deliberate: retention is a pure function of `now`, so the
 * cutoff boundary is testable without waiting 30 days.
 */

export const DEFAULT_BACKUP_DIR = "data/backups";
export const DEFAULT_ARCHIVE_DIR = "data/archive";
export const DEFAULT_RETENTION_DAYS = 30;

const SNAPSHOT_PREFIX = "midori-";
const SNAPSHOT_NAME = /^midori-\d{8}-\d{6}(?:-\d+)?\.db$/;
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;
const DAY_MS = 86_400_000;
const MAX_ARCHIVE_SUFFIX = 1000;

/** `midori-YYYYMMDD-HHMMSS.db`, UTC so the name sorts and matches mtimes. */
export function snapshotName(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("snapshotName: invalid Date");
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${SNAPSHOT_PREFIX}${date}-${time}.db`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Single-quote a path for SQL (VACUUM INTO takes a literal, not a parameter). */
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Run `PRAGMA integrity_check` on a database file, read-only. Throws unless the
 * only result row is `ok` — a corrupted file fails here instead of downstream.
 */
export function checkIntegrity(dbPath: string): void {
  if (!existsSync(dbPath)) throw new Error(`integrity_check: no such file: ${dbPath}`);
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db.query("PRAGMA integrity_check").all() as Array<{ integrity_check?: unknown }>;
    const results = rows.map((row) => String(row.integrity_check));
    if (results.length !== 1 || results[0] !== "ok") {
      throw new Error(`integrity_check reported problems: ${results.join("; ") || "no result"}`);
    }
  } catch (err) {
    throw new Error(`integrity_check failed for ${dbPath}: ${errorMessage(err)}`);
  } finally {
    db?.close();
  }
}

export interface BackupDatabaseOptions {
  backupDir: string;
  /** Injected for tests; defaults to the current time. */
  now?: Date;
}

export interface BackupDatabaseResult {
  snapshotPath: string;
  bytes: number;
}

/**
 * Checkpoint the WAL, snapshot the database with `VACUUM INTO`, and verify the
 * snapshot. Leaves the source database open only for the duration of the copy.
 */
export function backupDatabase(
  dbPath: string,
  options: BackupDatabaseOptions,
): BackupDatabaseResult {
  if (!existsSync(dbPath)) throw new Error(`backupDatabase: no database at ${dbPath}`);
  const now = options.now ?? new Date();
  mkdirSync(options.backupDir, { recursive: true });
  // Same-second re-imports are realistic (retries, scripted runs): allocate a
  // suffixed name instead of failing, exactly like zip archival does.
  const snapshotPath = freePath(join(options.backupDir, snapshotName(now)));

  const db = openDb(dbPath);
  try {
    const checkpoint = db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
      busy?: number;
    } | null;
    if (checkpoint?.busy) {
      throw new Error(
        `backupDatabase: WAL checkpoint is busy for ${dbPath} (another connection is reading); ` +
          "snapshot would miss the write-ahead log",
      );
    }
    db.exec(`VACUUM INTO ${sqlString(snapshotPath)}`);
  } catch (err) {
    // A failed VACUUM INTO can leave a partial file; never keep it.
    if (existsSync(snapshotPath)) rmSync(snapshotPath, { force: true });
    throw err;
  } finally {
    db.close();
  }

  try {
    checkIntegrity(snapshotPath);
  } catch (err) {
    rmSync(snapshotPath, { force: true });
    throw new Error(
      `backupDatabase: snapshot failed verification and was removed: ${errorMessage(err)}`,
    );
  }

  return { snapshotPath, bytes: statSync(snapshotPath).size };
}

export interface PruneBackupsOptions {
  /** Injected clock — prune never reads the system time. */
  now: Date;
  retentionDays?: number;
}

/**
 * Delete snapshots strictly older than `now - retentionDays`. A snapshot whose
 * mtime is exactly the cutoff is kept (the boundary belongs to the newer side).
 * Only files matching the snapshot name are considered.
 */
export function pruneBackups(backupDir: string, options: PruneBackupsOptions): string[] {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error(
      `pruneBackups: retentionDays must be a non-negative number, got ${retentionDays}`,
    );
  }
  const nowMs = options.now.getTime();
  if (Number.isNaN(nowMs)) throw new Error("pruneBackups: invalid now");
  const cutoffMs = nowMs - retentionDays * DAY_MS;

  if (!existsSync(backupDir)) return [];

  const deleted: string[] = [];
  for (const entry of readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || !SNAPSHOT_NAME.test(entry.name)) continue;
    const path = join(backupDir, entry.name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue; // vanished between listing and stat — nothing to prune
    }
    if (mtimeMs < cutoffMs) {
      unlinkSync(path);
      deleted.push(entry.name);
    }
  }
  return deleted.sort();
}

export interface ArchiveZipOptions {
  archiveDir: string;
}

/**
 * Move an imported export zip into the archive dir, creating it if missing.
 * Returns the path the zip landed at; a name clash gets a `-N` suffix rather
 * than overwriting a previously archived export.
 */
export function archiveZip(zipPath: string, options: ArchiveZipOptions): string {
  if (!existsSync(zipPath)) throw new Error(`archiveZip: no zip at ${zipPath}`);
  mkdirSync(options.archiveDir, { recursive: true });
  const destination = freePath(join(options.archiveDir, basename(zipPath)));
  try {
    renameSync(zipPath, destination);
  } catch (err) {
    throw new Error(
      `archiveZip: could not move ${zipPath} to ${destination}: ${errorMessage(err)}`,
    );
  }
  return destination;
}

function freePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = ext.length > 0 ? path.slice(0, -ext.length) : path;
  for (let n = 1; n <= MAX_ARCHIVE_SUFFIX; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`archiveZip: too many archived copies of ${path}`);
}

/** Remove sidecars that would otherwise be replayed against a restored database. */
function removeSidecars(dbPath: string): void {
  for (const suffix of SIDECAR_SUFFIXES) rmSync(`${dbPath}${suffix}`, { force: true });
}

export interface RestoreSnapshotResult {
  snapshotPath: string;
  targetPath: string;
}

/**
 * Replace `targetPath` with `snapshotPath`, then prove the result is readable.
 *
 * Ordered so a failure never leaves a half-restored target: verify the snapshot,
 * copy it beside the target, drop stale `-wal`/`-shm`/`-journal` sidecars, then
 * atomically rename the verified copy into place. The caller must ensure no
 * connection holds the target database while this runs.
 */
export function restoreSnapshot(snapshotPath: string, targetPath: string): RestoreSnapshotResult {
  if (!existsSync(snapshotPath)) {
    throw new Error(`restoreSnapshot: no snapshot at ${snapshotPath}`);
  }
  checkIntegrity(snapshotPath);

  mkdirSync(dirname(targetPath), { recursive: true });
  const stagingPath = `${targetPath}.restore-tmp`;
  rmSync(stagingPath, { force: true }); // leftover from an interrupted restore
  try {
    copyFileSync(snapshotPath, stagingPath);
    removeSidecars(targetPath);
    renameSync(stagingPath, targetPath);
  } catch (err) {
    rmSync(stagingPath, { force: true });
    throw new Error(
      `restoreSnapshot: could not restore ${snapshotPath} to ${targetPath}: ${errorMessage(err)}`,
    );
  }

  let db: Database | null = null;
  try {
    db = new Database(targetPath, { readonly: true });
    const row = db.query("SELECT COUNT(*) AS objects FROM sqlite_master").get() as {
      objects?: unknown;
    } | null;
    if (typeof row?.objects !== "number") {
      throw new Error("no readable schema");
    }
  } catch (err) {
    throw new Error(`restoreSnapshot: restored database is not readable: ${errorMessage(err)}`);
  } finally {
    db?.close();
  }

  return { snapshotPath, targetPath };
}
