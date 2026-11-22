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

const READ_ONLY_TOOLS = [
  "changes",
  "health_context",
  "metric_series",
  "nights",
  "epochs",
  "list_notes",
  "list_briefings",
  "list_imports",
];

const WRITE_TOOLS = ["add_note", "update_note", "save_briefing", "update_profile"];

function expectGuidance(tools: ReadonlyArray<{ description?: string | undefined }>) {
  for (const tool of tools) {
    expect(tool.description).toContain("Cite the specific nights");
    expect(tool.description).toContain(
      "Device changes, OS updates, partial data, travel, and personal notes are confounders",
    );
    expect(tool.description).toContain("midori does not assert causes");
  }
}

describe("MCP v1 tools", () => {
  test("B-A3 B-A6 read-only servers mount exactly the 8 read tools with cautious guidance", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(READ_ONLY_TOOLS);
    expectGuidance(tools);
  });

  test("B-A7 a read-only server does not mount the write tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of WRITE_TOOLS) expect(names).not.toContain(name);
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
      latestBriefing: null,
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
          author: "owner",
          authorName: null,
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

  test("B-A6 list_briefings is mounted read-only and validates the limit", async () => {
    const empty = await client.callTool({ name: "list_briefings", arguments: {} });
    expect(empty.isError).toBeUndefined();
    expect(JSON.parse(textContent(empty))).toEqual({ briefings: [] });

    for (const limit of [0, 51, 2.5]) {
      const invalid = await client.callTool({ name: "list_briefings", arguments: { limit } });
      expect(invalid.isError).toBe(true);
      expect(textContent(invalid)).toContain("limit must be an integer between 1 and 50");
    }
    expect(db.query("SELECT COUNT(*) count FROM briefings").get()).toEqual({ count: 0 });
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

describe("MCP writable tools (B-A7)", () => {
  let writeDb: Database;
  let writeClient: Client;

  beforeAll(async () => {
    writeDb = new Database(":memory:");
    applyMigrations(writeDb);
    const server = createMcpServer({ db: writeDb, writable: true });
    writeClient = new Client({ name: "midori-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([writeClient.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(() => writeDb?.close());

  test("B-A7 a writable server mounts all 12 tools, each carrying the guidance", async () => {
    const { tools } = await writeClient.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...READ_ONLY_TOOLS, ...WRITE_TOOLS]);
    expectGuidance(tools);
  });

  test("B-A7 add_note tags the row author agent with a validated authorName", async () => {
    const created = await writeClient.callTool({
      name: "add_note",
      arguments: {
        startDay: "2026-03-02",
        endDay: "2026-03-04",
        category: "travel",
        label: "  long flight ",
        authorName: " luna ",
      },
    });
    expect(created.isError).toBeUndefined();
    expect(JSON.parse(textContent(created))).toMatchObject({
      startDay: "2026-03-02",
      endDay: "2026-03-04",
      category: "travel",
      label: "long flight",
      author: "agent",
      authorName: "luna",
    });

    const defaulted = await writeClient.callTool({
      name: "add_note",
      arguments: { startDay: "2026-03-05", category: "stress", label: "deadline" },
    });
    expect(JSON.parse(textContent(defaulted))).toMatchObject({
      endDay: "2026-03-05",
      author: "agent",
      authorName: "agent",
    });

    for (const args of [
      { startDay: "2026-02-30", category: "travel", label: "bad date" },
      { startDay: "2026-03-02", category: "work", label: "bad category" },
      { startDay: "2026-03-02", category: "travel", label: "   " },
      { startDay: "2026-03-02", category: "travel", label: "ok", authorName: "   " },
      { startDay: "2026-03-02", category: "travel", label: "ok", authorName: "x".repeat(65) },
    ]) {
      const invalid = await writeClient.callTool({ name: "add_note", arguments: args });
      expect(invalid.isError).toBe(true);
    }
    expect(writeDb.query("SELECT COUNT(*) count FROM notes").get()).toEqual({ count: 2 });
    expect(writeDb.query("SELECT author, author_name FROM notes ORDER BY id").all()).toEqual([
      { author: "agent", author_name: "luna" },
      { author: "agent", author_name: "agent" },
    ]);
    expect(writeDb.query("SELECT COUNT(*) count FROM records").get()).toEqual({ count: 0 });
  });

  test("B-A7 update_note merges partial fields and keeps the audit trail", async () => {
    const list = await writeClient.callTool({ name: "list_notes", arguments: {} });
    const notes = (JSON.parse(textContent(list)) as { notes: Array<{ id: number }> }).notes;
    const id = notes[0]?.id ?? 0;
    expect(id).toBeGreaterThan(0);

    const patched = await writeClient.callTool({
      name: "update_note",
      arguments: { id, label: "flight home", authorName: "pi" },
    });
    expect(patched.isError).toBeUndefined();
    expect(JSON.parse(textContent(patched))).toMatchObject({
      startDay: "2026-03-05",
      label: "flight home",
      author: "agent",
      authorName: "pi",
    });

    const missing = await writeClient.callTool({
      name: "update_note",
      arguments: { id: 999, label: "nope" },
    });
    expect(missing.isError).toBe(true);
    expect(textContent(missing)).toBe("note not found");

    const invalid = await writeClient.callTool({
      name: "update_note",
      arguments: { id, endDay: "2026-03-01" },
    });
    expect(invalid.isError).toBe(true);
    expect(textContent(invalid)).toContain("endDay must be on or after startDay");
  });

  test("B-A7 save_briefing publishes an auditable, evidence-cited briefing", async () => {
    const saved = await writeClient.callTool({
      name: "save_briefing",
      arguments: {
        asOfDay: "2026-03-09",
        title: " HRV lower than usual ",
        summary: "Feb 3–9: HRV lower than usual. A watch change overlaps this window.",
        citedNights: ["2026-03-03", "2026-03-09"],
        citedMetrics: ["hrv_sdnn"],
        authorName: "luna",
      },
    });
    expect(saved.isError).toBeUndefined();
    const briefing = JSON.parse(textContent(saved)) as Record<string, unknown>;
    expect(briefing).toMatchObject({
      asOfDay: "2026-03-09",
      title: "HRV lower than usual",
      citedNights: ["2026-03-03", "2026-03-09"],
      citedMetrics: ["hrv_sdnn"],
      authorName: "luna",
    });

    const listed = await writeClient.callTool({ name: "list_briefings", arguments: { limit: 1 } });
    expect(JSON.parse(textContent(listed))).toEqual({ briefings: [briefing] });

    for (const args of [
      {
        asOfDay: "2026-02-30",
        title: "t",
        summary: "s",
        authorName: "luna",
      },
      { asOfDay: "2026-03-09", title: "   ", summary: "s", authorName: "luna" },
      { asOfDay: "2026-03-09", title: "t", summary: "s", authorName: "  " },
      {
        asOfDay: "2026-03-09",
        title: "t",
        summary: "s",
        authorName: "luna",
        citedMetrics: ["nope"],
      },
      {
        asOfDay: "2026-03-09",
        title: "t",
        summary: "s",
        authorName: "luna",
        citedNights: ["2026-02-30"],
      },
    ]) {
      const invalid = await writeClient.callTool({ name: "save_briefing", arguments: args });
      expect(invalid.isError).toBe(true);
    }
    expect(writeDb.query("SELECT COUNT(*) count FROM briefings").get()).toEqual({ count: 1 });
  });

  test("B-A7 update_profile merges partial fields over the stored profile", async () => {
    const partial = await writeClient.callTool({
      name: "update_profile",
      arguments: { goals: "  sleep earlier " },
    });
    expect(partial.isError).toBeUndefined();
    expect(JSON.parse(textContent(partial))).toMatchObject({
      goals: "sleep earlier",
      routine: "",
      medicalContext: "",
    });

    const second = await writeClient.callTool({
      name: "update_profile",
      arguments: { routine: "walk daily", medicalContext: "none recorded" },
    });
    expect(JSON.parse(textContent(second))).toMatchObject({
      goals: "sleep earlier",
      routine: "walk daily",
      medicalContext: "none recorded",
    });

    const invalid = await writeClient.callTool({
      name: "update_profile",
      arguments: { goals: "x".repeat(1001) },
    });
    expect(invalid.isError).toBe(true);
  });

  test("B-A7 no write tool mutates records or a derived table", async () => {
    const derived = [
      "records",
      "epochs",
      "epoch_events",
      "stints",
      "nights",
      "metric_values",
      "findings",
      "finding_snapshots",
      "seam_steps",
    ];
    for (const table of derived) {
      expect(
        (writeDb.query(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
      ).toBe(0);
    }
  });
});
