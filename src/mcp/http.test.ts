import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { SOURCE_B, SPIKE_ANCHOR, spike } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import { runImport } from "../ingest/import";
import { MCP_HTTP_PATH, mountMcp } from "./http";

/**
 * T21 verification: a real MCP client over streamable HTTP (fetch-based
 * transport) against a live local server, exercising the same tools as the
 * stdio test — proving the Hono mount serves agents, not just CLI pipes.
 */

const tmp = resolve(import.meta.dir, "../../.tmp-mcp-http-test");
const runId = randomUUID().slice(0, 8);
const dbPath = `${tmp}/db-${runId}.sqlite`;
const zipPath = `${tmp}/${runId}.zip`;
let db: Database;
let server: ReturnType<typeof Bun.serve>;
let url: string;

beforeAll(async () => {
  await Bun.write(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
  );
  await runImport(dbPath, zipPath);
  db = openDb(dbPath, { readonly: true });

  const app = new Hono();
  mountMcp(app, { db });
  server = Bun.serve({ port: 0, fetch: app.fetch });
  url = `http://localhost:${server.port}${MCP_HTTP_PATH}`;
});

afterAll(() => {
  server?.stop(true);
  db?.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // absent
    }
  }
  try {
    unlinkSync(zipPath);
  } catch {
    // absent
  }
});

describe("MCP over streamable HTTP", () => {
  test("client handshake + briefing tool call round-trips", async () => {
    const client = new Client({ name: "midori-http-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const res = await client.callTool({ name: "briefing", arguments: {} });
      const content = res.content;
      if (!Array.isArray(content) || content.length === 0) throw new Error("no content");
      const first = content[0];
      if (!first || first.type !== "text") throw new Error("non-text content");
      const b = JSON.parse(first.text) as {
        anchorDay: string;
        asOf: Record<string, { sourceName: string; day: string }>;
        findings: Array<{ kind: string; metric: string }>;
        lastImport: { status: string } | null;
      };
      expect(b.anchorDay).toBe(SPIKE_ANCHOR);
      expect(b.asOf.wrist_temp).toEqual({ sourceName: SOURCE_B, day: SPIKE_ANCHOR });
      expect(b.findings.some((f) => f.kind === "coverage" && f.metric === "wrist_temp")).toBe(true);
      expect(b.lastImport?.status).toBe("done");
    } finally {
      await client.close();
    }
  });

  test("no session id is issued (stateless)", async () => {
    const res = await fetch(url, {
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
          clientInfo: { name: "raw", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result?: { serverInfo?: { name: string } } };
    expect(body.result?.serverInfo?.name).toBe("midori");
  });

  test("GET and DELETE are refused with 405", async () => {
    const get = await fetch(url, { method: "GET" });
    expect(get.status).toBe(405);
    const del = await fetch(url, { method: "DELETE" });
    expect(del.status).toBe(405);
  });
});
