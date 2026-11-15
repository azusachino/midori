/**
 * E2E lifecycle (playwright-verify skill): build a hermetic fixture database from
 * the spike corpus, build the web shell, start the real server against it, run
 * Playwright with E2E_BASE_URL exported, and tear everything down. The config
 * starts no server of its own; `make e2e` and `make e2e-probe` both come here.
 *
 * Usage: bun scripts/e2e/run.ts [--project probe] [PROBE_ROUTE=/path] [extra playwright args]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spike } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";

const root = join(import.meta.dir, "..", "..");
const workdir = join(root, ".tmp-e2e");
const port = Number(process.env.E2E_PORT ?? 4173);
const baseUrl = `http://127.0.0.1:${port}`;

function run(cmd: string[], env: Record<string, string> = {}): number {
  const proc = Bun.spawnSync({
    cmd,
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exitCode ?? 1;
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/changes`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`server not ready at ${baseUrl} within 15s`);
}

// 1. Hermetic fixture database from the spike corpus.
rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
const zipPath = join(workdir, "fixture.zip");
writeFileSync(
  zipPath,
  buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
);
const dbPath = join(workdir, "midori.db");
const dbExit = run([
  "bun",
  "src/cli.ts",
  "import",
  zipPath,
  "--db",
  dbPath,
  "--backup-dir",
  join(workdir, "backups"),
  "--archive-dir",
  join(workdir, "archive"),
]);
if (dbExit !== 0) {
  console.error("e2e: fixture import failed");
  process.exit(dbExit);
}

// 2. Web shell build (the server serves web/dist).
const buildExit = run(["bun", "run", "build"]);
if (buildExit !== 0) {
  console.error("e2e: web build failed");
  process.exit(buildExit);
}

// 3. Real server against the fixture database.
const server = Bun.spawn({
  cmd: ["bun", "src/server.ts"],
  cwd: root,
  env: {
    ...process.env,
    MIDORI_DB: dbPath,
    MIDORI_PORT: String(port),
    MIDORI_HOST: "127.0.0.1",
  },
  stdout: "inherit",
  stderr: "inherit",
});

let exitCode = 1;
try {
  await waitUntilReady();
  // 4. Playwright against the running server.
  const passthrough = process.argv.slice(2);
  exitCode = run(["bunx", "playwright", "test", ...passthrough], { E2E_BASE_URL: baseUrl });
} catch (err) {
  console.error(`e2e: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  server.kill();
  await server.exited;
}

// 5. Keep the workdir only when something failed, for inspection.
if (exitCode === 0) rmSync(workdir, { recursive: true, force: true });
process.exit(exitCode);
