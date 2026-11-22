import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDb } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { createMcpServer } from "../../src/mcp/server";
import { type RecordSpec, renderExport, SLEEP_VALUE, TYPE } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

const dirs: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEVICE =
  "<<HKDevice: 0x1>, name:Synthetic Watch, hardware:Watch7,5, software:26.1, model:Watch>";

function sleepRecords(nights: number): RecordSpec[] {
  return Array.from({ length: nights }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const next = String(index + 2).padStart(2, "0");
    return {
      type: TYPE.sleep,
      sourceName: "Synthetic Watch",
      startDate: `2026-02-${day} 22:00:00 +0000`,
      endDate: `2026-02-${next} 06:00:00 +0000`,
      value: SLEEP_VALUE.core,
      device: DEVICE,
    };
  });
}

function writeExport(dir: string, name: string, records: RecordSpec[]): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    buildStoredZip([
      {
        name: "apple_health_export/export.xml",
        data: renderExport({ exportDate: "2026-02-21 08:00:00 +0000", records, workouts: [] }),
      },
    ]),
  );
  return path;
}

function textContent(result: unknown): string {
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
}

describe("MCP v2 parity", () => {
  test("changes exposes sinceLastImport, recentNotes, and user_note parity with REST", async () => {
    const dir = mkdtempSync(join(tmpdir(), "midori-mcp-v2-"));
    dirs.push(dir);
    const dbPath = join(dir, "fixture.db");
    await runImport(dbPath, writeExport(dir, "first.zip", sleepRecords(7)));
    await runImport(dbPath, writeExport(dir, "second.zip", sleepRecords(14)));
    const db = openDb(dbPath);
    databases.push(db);
    db.run(
      `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
       VALUES ('2026-02-13', '2026-02-13', 'illness', 'fever', '2026-02-13T00:00:00Z', '2026-02-13T00:00:00Z')`,
    );

    const server = createMcpServer({ db });
    const client = new Client({ name: "midori-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: "changes", arguments: {} });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(textContent(result)) as {
      asOf: string;
      rows: Array<{
        metric: string;
        checks: Array<{ key: string; flagged: boolean; day?: string }>;
        caveats: string[];
      }>;
      sinceLastImport: { fromImportId: number; toImportId: number } | null;
      recentNotes: Array<{ startDay: string; label: string }>;
    };
    expect(payload.asOf).toBe("2026-02-14");
    expect(payload.sinceLastImport).toMatchObject({ fromImportId: 1, toImportId: 2 });
    expect(payload.recentNotes).toEqual([expect.objectContaining({ label: "fever" })]);

    const sleepRow = payload.rows.find((row) => row.metric === "sleep_h");
    expect(sleepRow?.checks.find((check) => check.key === "user_note")).toMatchObject({
      flagged: true,
      day: "2026-02-13",
    });
    expect(sleepRow?.caveats).toContain("A personal note overlaps the recent window.");

    // Same rows/order/checks as REST, which is the B-A1 parity contract.
    const changes = (await (await createApp({ db }).request("/api/changes")).json()) as {
      overnight: Array<{
        metric: string;
        checks: Array<{ key: string; flagged: boolean; day?: string }>;
      }>;
      daytime: Array<{
        metric: string;
        checks: Array<{ key: string; flagged: boolean; day?: string }>;
      }>;
    };
    expect(payload.rows.map((row) => row.metric)).toEqual(
      [...changes.overnight, ...changes.daytime].map((row) => row.metric),
    );
    expect(sleepRow?.checks).toEqual(
      changes.overnight.find((row) => row.metric === "sleep_h")?.checks,
    );

    const notes = await client.callTool({
      name: "list_notes",
      arguments: { from: "2026-02-12", to: "2026-02-14" },
    });
    expect(JSON.parse(textContent(notes))).toEqual({
      notes: [expect.objectContaining({ startDay: "2026-02-13", category: "illness" })],
    });

    await client.close();
    await server.close();
  });
});
