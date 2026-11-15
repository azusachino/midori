import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../../src/db/db";
import { runImport } from "../../src/ingest/import";
import { startServer } from "../../src/server";
import { spike } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

/**
 * T15 smoke: the Bun.serve handler wiring. /api answers JSON from an imported fixture db;
 * everything else serves the built web shell. The server starts on an ephemeral port and
 * is stopped inside the test run.
 */

const tmp = resolve(import.meta.dir, "../../.tmp-server-test");
const runId = randomUUID().slice(0, 8);
const dbPath = `${tmp}/db-${runId}.sqlite`;
const zipPath = `${tmp}/${runId}.zip`;
const webDist = `${tmp}/web-${runId}`;

let server: ReturnType<typeof startServer> | undefined;
let base = "";

beforeAll(async () => {
  mkdirSync(tmp, { recursive: true });
  await Bun.write(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
  );
  await runImport(dbPath, zipPath);

  mkdirSync(`${webDist}/assets`, { recursive: true });
  writeFileSync(`${webDist}/index.html`, "<!doctype html><title>shell</title>");
  writeFileSync(`${webDist}/assets/app.js`, "console.log('ok');");

  server = startServer({
    db: openDb(dbPath),
    dbPath,
    port: 0,
    hostname: "127.0.0.1",
    webDist,
    spoolDir: `${tmp}/spool-${runId}`,
    archiveDir: `${tmp}/archive-${runId}`,
    backupDir: `${tmp}/backups-${runId}`,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // absent
    }
  }
  rmSync(webDist, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe("server wiring (T15 smoke)", () => {
  test("GET /api/sources returns 200 JSON from the fixture db", async () => {
    const res = await fetch(`${base}/api/sources`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const rows = (await res.json()) as Array<{ name: string; recordCount: number }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.recordCount).toBeGreaterThan(0);
  });

  test("GET /api/... is never shadowed by the static fallback", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("text/html");
  });

  test("GET / serves the built index.html", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });

  test("client routes fall back to index.html, asset files are served directly", async () => {
    const page = await fetch(`${base}/investigate`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("shell");

    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");
  });

  test("path traversal never leaves the web root", async () => {
    const res = await fetch(`${base}/..%2F..%2Fpackage.json`);
    expect(res.status).not.toBe(200);
    const raw = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
    expect(raw.status).not.toBe(200);
  });

  test("non-GET methods on web paths are rejected", async () => {
    const res = await fetch(`${base}/briefing`, { method: "POST", body: "x" });
    expect(res.status).toBe(405);
  });
});
