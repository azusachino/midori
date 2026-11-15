import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyMigrations } from "../db/db";
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

describe("MCP during the derived-schema transition", () => {
  test("v0 derived tools report the planned temporary unavailability", async () => {
    for (const name of ["metric_daily", "deviations", "findings", "briefing"]) {
      const result = await client.callTool({
        name,
        arguments: name === "metric_daily" ? { metric: "rhr" } : {},
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual({
        type: "text",
        text: "v1 derived reads arrive in slice 10",
      });
    }
  });

  test("import listing remains available and read-only", async () => {
    const result = await client.callTool({ name: "list_imports", arguments: {} });
    expect(result.isError).toBeUndefined();
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("missing import list response");
    const text = content.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    );
    if (!text) throw new Error("missing import list response");
    expect(JSON.parse(text.text)).toMatchObject([{ zipName: "synthetic.zip", status: "done" }]);
  });
});
