import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spike } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import { createApp } from "../http/routes";
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

  const app = createApp({ db });
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
  test("B-A1 changes rows match the REST rows and ordering", async () => {
    const client = new Client({ name: "midori-http-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const [mcpResult, restResponse] = await Promise.all([
        client.callTool({ name: "changes", arguments: {} }),
        fetch(url.replace(MCP_HTTP_PATH, "/api/changes")),
      ]);
      expect(mcpResult.isError).toBeUndefined();
      expect(restResponse.status).toBe(200);
      const mcpContent = mcpResult.content;
      if (!Array.isArray(mcpContent) || mcpContent[0]?.type !== "text")
        throw new Error("missing MCP changes response");
      const mcp = JSON.parse(mcpContent[0].text) as {
        asOf: string | null;
        rows: Array<Record<string, unknown> & { asOf: string | null }>;
      };
      const rest = (await restResponse.json()) as {
        asOfDay: string | null;
        overnight: Array<Record<string, unknown>>;
        daytime: Array<Record<string, unknown>>;
      };
      expect(mcp.asOf).toBe(rest.asOfDay);
      expect(mcp.rows.map(({ metric }) => metric)).toEqual(
        [...rest.overnight, ...rest.daytime].map(({ metric }) => metric),
      );
      expect(
        mcp.rows.map(({ asOf: _asOf, epoch: _epoch, caveats: _caveats, ...row }) => row),
      ).toEqual([...rest.overnight, ...rest.daytime]);
      for (const row of mcp.rows) {
        expect(row.asOf).toBe(rest.asOfDay);
        expect(row).toHaveProperty("state");
        expect(row).toHaveProperty("confidence");
        expect(row).toHaveProperty("onset");
        expect(row).toHaveProperty("checks");
        expect(row).toHaveProperty("trust");
        expect(Array.isArray(row.caveats)).toBe(true);
        if (row.epochId === null) expect(row.epoch).toBeNull();
        else
          expect(row.epoch).toMatchObject({
            id: row.epochId,
            label: row.epochLabel,
            hardware: row.epochLabel,
          });
      }
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
