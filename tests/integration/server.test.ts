/**
 * Integration test for the full server entry (T22): one Bun.serve over the real
 * startServer — REST + web shell + stateless MCP-over-HTTP on the same port.
 * Covers the /mcp wiring that the standalone mcp tests cannot (fetch-handler
 * routing) and the env-independent ServerOptions defaults.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/db/db";
import { runImport } from "../../src/ingest/import";
import { startServer } from "../../src/server";
import { renderExport, SLEEP_VALUE, spike, TYPE } from "../../tests/fixtures";
import { buildStoredZip } from "../util/mkzip";

const workdir = join(import.meta.dir, "..", "..", ".tmp-server-test");
let server: ReturnType<typeof startServer> | null = null;
let baseUrl = "";

beforeEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  rmSync(workdir, { recursive: true, force: true });
});

describe("server entry: REST + web shell + MCP on one port", () => {
  test("B-I10 startup marks interrupted imports failed and exposes them over HTTP", async () => {
    const dbPath = join(workdir, "restart.db");
    const db = openDb(dbPath);
    db.run(
      `INSERT INTO imports (created_at, zip_name, zip_size, status, stage)
       VALUES ('2026-01-01T00:00:00.000Z', 'interrupted.zip', 10, 'parsing', 'parsing')`,
    );
    db.close();

    server = startServer({ db: openDb(dbPath), dbPath, port: 0, spoolDir: join(workdir, "spool") });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/imports/1`);
    expect(res.status).toBe(200);
    const item = (await res.json()) as Record<string, unknown>;
    expect(item.status).toBe("failed");
    expect(item.stage).toBe("parsing");
    expect(item.error).toBe("interrupted by restart");
    expect(item.retryable).toBe(false);
  });

  test("GET /api/health returns ok", async () => {
    const dbPath = join(workdir, "health.db");
    server = startServer({ db: openDb(dbPath), dbPath, port: 0, spoolDir: join(workdir, "spool") });
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("M1 /api/changes stays responsive while a worker import is deriving", async () => {
    const dbPath = join(workdir, "worker.db");
    const zipPath = join(workdir, "fixture.zip");
    const device =
      "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";
    const records = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return {
        type: TYPE.sleep,
        sourceName: "Synthetic Watch",
        startDate: `2026-02-${day} 22:00:00 +0000`,
        endDate: `2026-02-${String(index + 2).padStart(2, "0")} 06:00:00 +0000`,
        value: SLEEP_VALUE.core,
        device,
      };
    });
    writeFileSync(
      zipPath,
      buildStoredZip([
        {
          name: "apple_health_export/export.xml",
          data: renderExport({ exportDate: "2026-02-21 08:00:00 +0000", records, workouts: [] }),
        },
      ]),
    );
    const initial = await runImport(dbPath, zipPath);
    expect(initial.asOfDay).toBe("2026-02-07");

    server = startServer({
      db: openDb(dbPath),
      dbPath,
      port: 0,
      spoolDir: join(workdir, "spool"),
      deriveSpinMs: 800,
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const upload = await fetch(`${origin}/api/imports`, {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        "x-zip-name": "synthetic.zip",
      },
      body: await Bun.file(zipPath).arrayBuffer(),
    });
    expect(upload.status).toBe(202);
    const { importId } = (await upload.json()) as { importId: number };
    const deadline = Date.now() + 10_000;
    let stage = "";
    while (stage !== "deriving" && Date.now() < deadline) {
      const detail = await fetch(`${origin}/api/imports/${importId}`);
      stage = ((await detail.json()) as { stage: string }).stage;
      if (stage !== "deriving") await Bun.sleep(5);
    }
    expect(stage).toBe("deriving");

    const started = performance.now();
    const changes = await fetch(`${origin}/api/changes`);
    const elapsedMs = performance.now() - started;
    expect(changes.status).toBe(200);
    expect(elapsedMs).toBeLessThan(500);
    expect(((await changes.json()) as { asOfDay: string | null }).asOfDay).toBe(initial.asOfDay);
    let status = "running";
    while (status !== "done" && status !== "failed" && Date.now() < deadline) {
      const detail = await fetch(`${origin}/api/imports/${importId}`);
      status = ((await detail.json()) as { status: string }).status;
      if (status !== "done" && status !== "failed") await Bun.sleep(5);
    }
    expect(status).toBe("done");
  });

  test("changes, web shell and MCP initialize answer on the same origin", async () => {
    const dbPath = join(workdir, "midori.db");
    writeFileSync(
      join(workdir, "fixture.zip"),
      buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
    );
    await runImport(dbPath, join(workdir, "fixture.zip"));

    // Minimal web shell so the static path has an index to fall back to.
    const webDist = join(workdir, "web", "dist");
    mkdirSync(webDist, { recursive: true });
    writeFileSync(join(webDist, "index.html"), "<!doctype html><title>midori</title>");

    server = startServer({ db: openDb(dbPath, { readonly: true }), dbPath, port: 0, webDist });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const changes = await fetch(`${baseUrl}/api/changes`);
    expect(changes.status).toBe(200);
    const body = (await changes.json()) as { asOfDay: string | null; hasImports: boolean };
    expect(body).toMatchObject({ asOfDay: null, hasImports: true });

    const shell = await fetch(`${baseUrl}/some/client/route`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("midori");

    // Stateless MCP: initialize + a tool call, no session header anywhere.
    const init = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(initBody.result?.serverInfo?.name).toBe("midori");

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const toolBody = (await tools.json()) as { result?: { tools?: { name: string }[] } };
    const names = toolBody.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toEqual(["changes", "metric_series", "nights", "epochs", "list_imports"]);
  });
});
