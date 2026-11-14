import {
  archiveZip,
  backupDatabase,
  DEFAULT_ARCHIVE_DIR,
  DEFAULT_BACKUP_DIR,
  pruneBackups,
} from "./backup/backup";
import { runImport } from "./ingest/import";

/**
 * midori CLI (T6). `bun src/cli.ts import <export.zip> [--db <path>]`.
 * After a successful import (design: "backups are owned by midori"): WAL-checkpointed
 * snapshot into the backup dir, retention prune, and the zip moves into the archive
 * dir unless --keep-zip. Prints a JSON summary; non-zero exit on failure.
 */

function usage(): never {
  console.error(
    "usage: bun src/cli.ts import <export.zip> [--db <path>] [--backup-dir <dir>] " +
      "[--archive-dir <dir>] [--keep-zip]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0];
if (command !== "import") usage();

let zipPath: string | null = null;
let dbPath = "data/midori.db";
let backupDir = DEFAULT_BACKUP_DIR;
let archiveDir = DEFAULT_ARCHIVE_DIR;
let keepZip = false;
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === undefined) break;
  if (a === "--db") {
    dbPath = args[i + 1] ?? usage();
    i += 1;
  } else if (a === "--backup-dir") {
    backupDir = args[i + 1] ?? usage();
    i += 1;
  } else if (a === "--archive-dir") {
    archiveDir = args[i + 1] ?? usage();
    i += 1;
  } else if (a === "--keep-zip") {
    keepZip = true;
  } else if (!zipPath) {
    zipPath = a;
  } else {
    usage();
  }
}
if (!zipPath) usage();

const summary = await runImport(dbPath, zipPath);

let backupPath: string | null = null;
let archivedPath: string | null = null;
if (summary.status === "done") {
  backupPath = backupDatabase(dbPath, { backupDir }).snapshotPath;
  pruneBackups(backupDir, { now: new Date() });
  if (!keepZip) archivedPath = archiveZip(zipPath, { archiveDir });
}

console.log(JSON.stringify({ ...summary, backupPath, archivedPath }, null, 2));
