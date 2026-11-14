import { runImport } from "./ingest/import";

/**
 * midori CLI (T6). `bun src/cli.ts import <export.zip> [--db <path>]`.
 * Prints a JSON summary; non-zero exit on failure.
 */

function usage(): never {
  console.error("usage: bun src/cli.ts import <export.zip> [--db <path>]");
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0];
if (command !== "import") usage();

let zipPath: string | null = null;
let dbPath = "data/midori.db";
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === undefined) break;
  if (a === "--db") {
    dbPath = args[i + 1] ?? usage();
    i += 1;
  } else if (!zipPath) {
    zipPath = a;
  } else {
    usage();
  }
}
if (!zipPath) usage();

const summary = await runImport(dbPath, zipPath);
console.log(JSON.stringify(summary, null, 2));
