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
  test("B-A3 tool descriptions require cautious evidence and no cause claims", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "changes",
      "health_context",
      "metric_series",
      "nights",
      "epochs",
      "list_notes",
      "list_imports",
    ]);
    for (const tool of tools) {
      expect(tool.description).toContain("Cite the specific nights");
      expect(tool.description).toContain(
        "Device changes, OS updates, partial data, travel, and personal notes are confounders",
      );
      expect(tool.description).toContain("midori does not assert causes");
    }
  });

  test("B-A1 changes includes as-of and row-level epoch context", async () => {
    const result = await client.callTool({ name: "changes", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textContent(result))).toEqual({
      asOf: null,
      rows: [],
      sinceLastImport: null,
      recentNotes: [],
    });
  });

  test("B-A5 health_context returns the dossier shape and rejects days outside 7..30", async () => {
    const result = await client.callTool({ name: "health_context", arguments: { days: 7 } });
    expect(result.isError).toBeUndefined();
    const dossier = JSON.parse(textContent(result));
    expect(dossier).toMatchObject({
      asOfDay: null,
      primaryWatch: null,
      profile: { goals: "", routine: "", medicalContext: "", updatedAt: null },
      summary: { standsOut: 0, closeToEdge: 0, within: 0, other: 0, sharedConfounders: [] },
      findings: [],
      sinceLastImport: null,
      recentNights: [],
      recentNotes: [],
    });
    expect(dossier.guidance).toContain("midori does not assert causes");

    for (const days of [6, 31, 14.5]) {
      const invalid = await client.callTool({ name: "health_context", arguments: { days } });
      expect(invalid.isError).toBe(true);
      expect(textContent(invalid)).toContain("days must be an integer between 7 and 30");
    }
  });

  test("B-U4 list_notes is read-only, filters by range, and rejects invalid dates", async () => {
    db.run(
      `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
       VALUES ('2026-03-02', '2026-03-04', 'travel', 'trip', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z')`,
    );
    const all = await client.callTool({ name: "list_notes", arguments: {} });
    expect(all.isError).toBeUndefined();
    expect(JSON.parse(textContent(all))).toEqual({
      notes: [
        {
          id: 1,
          startDay: "2026-03-02",
          endDay: "2026-03-04",
          category: "travel",
          label: "trip",
          createdAt: "2026-03-02T00:00:00Z",
          updatedAt: "2026-03-02T00:00:00Z",
        },
      ],
    });
    const filtered = await client.callTool({
      name: "list_notes",
      arguments: { from: "2026-03-05", to: "2026-03-06" },
    });
    expect(JSON.parse(textContent(filtered))).toEqual({ notes: [] });
    const invalid = await client.callTool({
      name: "list_notes",
      arguments: { from: "2026-02-30" },
    });
    expect(invalid.isError).toBe(true);
    expect(textContent(invalid)).toContain("valid from and to dates are required");
    expect(db.query("SELECT COUNT(*) count FROM notes").get()).toEqual({ count: 1 });
  });

  test("B-A2 any tool is read-only and unknown metrics return the known list", async () => {
    const before = db.query("SELECT COUNT(*) count FROM imports").get();
    const result = await client.callTool({
      name: "metric_series",
      arguments: { metric: "unknown_metric" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textContent(result))).toEqual({
      error: "unknown metric: unknown_metric",
      known: Object.keys(METRICS),
    });
    expect(db.query("SELECT COUNT(*) count FROM imports").get()).toEqual(before);
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

  test("B-A2 import listing remains available and read-only", async () => {
    const result = await client.callTool({ name: "list_imports", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textContent(result))).toMatchObject([
      { zipName: "synthetic.zip", status: "done" },
    ]);
    expect(db.query("SELECT COUNT(*) count FROM imports").get()).toEqual({ count: 1 });
  });
});
