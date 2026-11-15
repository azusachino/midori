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
import { spike } from "../../tests/fixtures";
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
    expect(item.stage).toBe("failed");
    expect(item.error).toBe("interrupted by restart");
    expect(item.retryable).toBe(false);
  });

  test("briefing, web shell and MCP initialize answer on the same origin", async () => {
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

    const briefing = await fetch(`${baseUrl}/api/briefing`);
    expect(briefing.status).toBe(501);
    const body = (await briefing.json()) as { error: string };
    expect(body.error).toContain("v1 routes arrive in slice 9");

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
    expect(names).toContain("briefing");
    expect(names).toContain("deviations");
  });
});
