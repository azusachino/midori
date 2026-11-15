/**
 * Container smoke (T22): prove the built image works end-to-end in isolation —
 * synthetic import through the HTTP upload route, briefing with real content,
 * MCP over HTTP — and that the image carries no personal data files.
 *
 * Usage: bun scripts/smoke-container.ts [--image azusachino.com/midori:v0.1.0]
 * (the Makefile smoke-container target passes the canonical tag).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spike } from "../tests/fixtures";
import { buildStoredZip } from "../tests/util/mkzip";

const root = join(import.meta.dir, "..");
const workdir = join(root, ".tmp-container");
const image = (() => {
  const i = process.argv.indexOf("--image");
  return i !== -1 ? (process.argv[i + 1] ?? "") : "azusachino.com/midori:v0.1.0";
})();
if (!image) throw new Error("--image required");
const port = Number(process.env.SMOKE_PORT ?? 4183);
const baseUrl = `http://127.0.0.1:${port}`;
const container = "midori-smoke";

function fail(msg: string): never {
  console.error(`smoke-container: FAIL — ${msg}`);
  Bun.spawnSync({ cmd: ["podman", "rm", "-f", container], stdout: "ignore", stderr: "ignore" });
  process.exit(1);
}

function run(
  cmd: string[],
  opts: { stdout?: "pipe" | "inherit" } = {},
): { code: number; out: string } {
  const proc = Bun.spawnSync({ cmd, stdout: opts.stdout ?? "inherit", stderr: "inherit" });
  // Piped stdout arrives as a Buffer (or null when empty) — never a string.
  const out = proc.stdout ? proc.stdout.toString() : "";
  return { code: proc.exitCode ?? 1, out };
}

// 0. Image content inspection: no personal-data files anywhere in the image.
const inspect = run(
  [
    "podman",
    "run",
    "--rm",
    "--entrypoint",
    "/bin/sh",
    image,
    "-c",
    // db/sqlite/export zips/Apple Health XML; node_modules excluded (bundlers ship .db caches rarely, but scan anyway minus the noise dir).
    "find / -xdev \\( -name '*.db' -o -name '*.sqlite*' -o -name '*.zip' -o -name 'export*.xml' \\) -not -path '*/node_modules/*' -not -path '/proc/*' -not -path '/sys/*' 2>/dev/null || true",
  ],
  { stdout: "pipe" },
);
const hits = inspect.out.trim();
// The runtime itself is clean by construction; anything found means build context leaked.
if (hits !== "") fail(`personal-data-looking files in image:\n${hits}`);
console.log("smoke-container: image content clean (no .db/.zip/export*.xml outside /proc,/sys)");

rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });

// 1. Start the container on an ephemeral host port.
const started = run([
  "podman",
  "run",
  "-d",
  "--rm",
  "--name",
  container,
  "-p",
  `127.0.0.1:${port}:8080`,
  image,
]);
if (started.code !== 0) fail("podman run failed");

try {
  // 2. Wait for the web shell / API to answer.
  let up = false;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/changes`);
      if (res.status === 200) {
        up = true;
        break;
      }
    } catch {
      // not yet
    }
    await Bun.sleep(300);
  }
  if (!up) {
    const logs = run(["podman", "logs", container], { stdout: "pipe" });
    fail(`server never answered; logs:\n${logs.out}`);
  }
  console.log("smoke-container: server up, empty-store briefing answers 200");

  // 3. Fresh store must have no imports yet, then upload the synthetic zip.
  const zipPath = join(workdir, "fixture.zip");
  writeFileSync(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
  );
  const zip = Bun.file(zipPath);
  const post = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: { "content-type": "application/zip", "x-zip-name": "fixture.zip" },
    body: zip,
  });
  if (post.status !== 202) fail(`upload not accepted (status ${post.status})`);
  const accepted = (await post.json()) as { importId?: number };
  const importId = accepted.importId;
  if (typeof importId !== "number") fail("202 body missing importId");

  // 4. Poll the job to done.
  let done = false;
  const jobDeadline = Date.now() + 120_000;
  while (Date.now() < jobDeadline) {
    const res = await fetch(`${baseUrl}/api/imports`);
    const rows = (await res.json()) as { id: number; status: string; recordsInserted?: number }[];
    const row = rows.find((r) => r.id === importId);
    if (row?.status === "failed") fail(`import job failed: ${JSON.stringify(row)}`);
    if (row?.status === "done") {
      done = true;
      if (!row.recordsInserted || row.recordsInserted <= 0) {
        fail(`import done but recordsInserted=${row.recordsInserted}`);
      }
      break;
    }
    await Bun.sleep(400);
  }
  if (!done) fail("import job never reached done");
  console.log("smoke-container: synthetic import completed inside the container");

  // 5. Briefing carries real content from the fixture corpus.
  const changes = (await (await fetch(`${baseUrl}/api/changes`)).json()) as {
    asOfDay: string | null;
  };
  if (changes.asOfDay !== "2026-03-01") fail(`asOfDay=${changes.asOfDay}, expected 2026-03-01`);
  console.log("smoke-container: changes asOfDay = 2026-03-01 (fixture corpus)");

  // 6. MCP over HTTP: initialize + tools/list on the same origin.
  const mcpPost = (payload: unknown) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
    });
  const init = (await (
    await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    })
  ).json()) as { result?: { serverInfo?: { name?: string } } };
  if (init.result?.serverInfo?.name !== "midori")
    fail("MCP initialize did not report serverInfo.name=midori");
  const tools = (await (await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
    result?: { tools?: { name: string }[] };
  };
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  if (!names.includes("briefing")) fail(`tools/list missing briefing: ${names.join(",")}`);
  console.log(`smoke-container: MCP over HTTP ok (${names.length} tools)`);

  // 7. Backup + archive landed on the volume path (the archive keeps the spooled
  //    uuid name; the snapshot is midori-YYYYMMDD-HHMMSS.db). Give the post-import
  //    maintenance a moment: `done` is set inside runImport, before backup/archive.
  await Bun.sleep(1_000);
  const files = run(
    ["podman", "exec", container, "sh", "-c", "ls /data/backups /data/archive 2>/dev/null || true"],
    { stdout: "pipe" },
  );
  if (!/^midori-\d{8}-\d{6}(-\d+)?\.db$/m.test(files.out))
    fail(`no snapshot under /data/backups:\n${files.out}`);
  if (!/\.zip(\s|$)/m.test(files.out)) fail(`zip not archived under /data/archive:\n${files.out}`);
  console.log("smoke-container: snapshot + zip archive present under /data");

  console.log("smoke-container: PASS");
} finally {
  run(["podman", "rm", "-f", container]);
  rmSync(workdir, { recursive: true, force: true });
}
