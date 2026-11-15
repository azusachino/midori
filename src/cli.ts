import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  archiveZip,
  backupDatabase,
  DEFAULT_ARCHIVE_DIR,
  DEFAULT_BACKUP_DIR,
  pruneBackups,
} from "./backup/backup";
import { openDb } from "./db/db";
import { runImport } from "./ingest/import";
import { createMcpServer } from "./mcp/server";
import { readFindings } from "./stats/findings";

/**
 * midori CLI. Subcommands:
 *   import <export.zip> [--db <path>] [--backup-dir <dir>] [--archive-dir <dir>] [--keep-zip]
 *   mcp [--db <path>] — read-only MCP server over stdio (T20)
 *   changes --json [--db <path>] — print ranked finding rows
 *
 * After a successful import (design: "backups are owned by midori"): WAL-checkpointed
 * snapshot into the backup dir, retention prune, and the zip moves into the archive
 * dir unless --keep-zip. Prints a JSON summary; non-zero exit on failure.
 */

function usage(): never {
  console.error(
    "usage: bun src/cli.ts import <export.zip> [--db <path>] [--backup-dir <dir>] " +
      "[--archive-dir <dir>] [--keep-zip]\n" +
      "       bun src/cli.ts backup [--db <path>] [--backup-dir <dir>] [--retention-days <n>]\n" +
      "       bun src/cli.ts mcp [--db <path>]\n" +
      "       bun src/cli.ts changes --json [--db <path>]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0];

if (command === "changes") {
  let dbPath = "data/midori.db";
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--db") {
      dbPath = args[i + 1] ?? usage();
      i += 1;
    } else usage();
  }
  if (!json) usage();
  const db = openDb(dbPath, { readonly: true });
  try {
    console.log(JSON.stringify(readFindings(db), null, 2));
  } finally {
    db.close();
  }
} else if (command === "mcp") {
  // stdio MCP server: JSON-RPC over stdin/stdout. Logs must go to stderr only.
  let dbPath = "data/midori.db";
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--db") {
      dbPath = args[i + 1] ?? usage();
      i += 1;
    } else {
      usage();
    }
  }
  const db = openDb(dbPath, { readonly: true });
  const server = createMcpServer({ db });
  await server.connect(new StdioServerTransport());
} else if (command === "import") {
  await runImportCommand(args);
} else if (command === "backup") {
  // Nightly CronJob entry (T24): snapshot + integrity check + retention prune.
  let dbPath = "data/midori.db";
  let backupDir = DEFAULT_BACKUP_DIR;
  let retentionDays = 30;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--db") {
      dbPath = args[i + 1] ?? usage();
      i += 1;
    } else if (a === "--backup-dir") {
      backupDir = args[i + 1] ?? usage();
      i += 1;
    } else if (a === "--retention-days") {
      retentionDays = Number(args[i + 1] ?? usage());
      if (!Number.isInteger(retentionDays) || retentionDays < 1) usage();
      i += 1;
    } else {
      usage();
    }
  }
  const { snapshotPath, bytes } = await backupDatabase(dbPath, { backupDir });
  const pruned = pruneBackups(backupDir, { now: new Date(), retentionDays });
  console.log(JSON.stringify({ ok: true, snapshotPath, bytes, pruned: pruned.length }, null, 2));
} else {
  usage();
}

async function runImportCommand(args: string[]): Promise<void> {
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
    backupPath = (await backupDatabase(dbPath, { backupDir })).snapshotPath;
    pruneBackups(backupDir, { now: new Date() });
    if (!keepZip) archivedPath = archiveZip(zipPath, { archiveDir });
  }

  console.log(JSON.stringify({ ...summary, backupPath, archivedPath }, null, 2));
}
