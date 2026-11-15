import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyMigrations } from "../db/db";
import { METRICS } from "../domain/metrics";
import { createMcpServer } from "./server";

let db: Database;
let client: Client;

beforeAll(async () => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  ).run();
  const server = createMcpServer({ db });
  client = new Client({ name: "midori-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(() => db?.close());

const textContent = (result: unknown) => {
  if (typeof result !== "object" || result === null || !("content" in result))
    throw new Error("missing tool response content");
  if (!Array.isArray(result.content)) throw new Error("missing tool response content");
  const text = result.content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string",
  );
  if (!text) throw new Error("missing text response");
  return text.text;
};

describe("MCP v1 tools", () => {
  test("registers only the v1 read tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "changes",
      "metric_series",
      "nights",
      "epochs",
      "list_imports",
    ]);
    for (const tool of tools) {
      expect(tool.description).toContain("Cite the specific nights");
      expect(tool.description).toContain(
        "Device changes, OS updates, partial data, and travel are confounders",
      );
      expect(tool.description).toContain("midori does not assert causes");
    }
  });

  test("changes includes as-of and row-level epoch context", async () => {
    const result = await client.callTool({ name: "changes", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textContent(result))).toEqual({ asOf: null, rows: [] });
  });

  test("unknown metric is an MCP error with the known list", async () => {
    const result = await client.callTool({
      name: "metric_series",
      arguments: { metric: "unknown_metric" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textContent(result))).toEqual({
      error: "unknown metric: unknown_metric",
      known: Object.keys(METRICS),
    });
  });

  test("nights rejects ranges over 400 days with a narrowing hint", async () => {
    const result = await client.callTool({
      name: "nights",
      arguments: { from: "2024-01-01", to: "2025-02-05" },
    });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("cannot exceed 400 days");
    expect(textContent(result)).toContain("narrow the date range");
  });

  test("import listing remains available and read-only", async () => {
    const result = await client.callTool({ name: "list_imports", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textContent(result))).toMatchObject([
      { zipName: "synthetic.zip", status: "done" },
    ]);
    expect(db.query("SELECT COUNT(*) count FROM imports").get()).toEqual({ count: 1 });
  });
});
