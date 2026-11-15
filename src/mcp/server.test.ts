import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SOURCE_B, SPIKE_ANCHOR, SPIKE_WINDOWS, spike } from "../../tests/fixtures";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import { runImport } from "../ingest/import";
import { createMcpServer } from "./server";

/**
 * T20 verification per plan: a scripted MCP client session asserts tool
 * outputs — the same acceptance the checkpoint-4 pi session will exercise,
 * runnable in CI. Client + server are joined over an in-memory transport pair.
 */

const tmp = resolve(import.meta.dir, "../../.tmp-mcp-test");
const runId = randomUUID().slice(0, 8);
const dbPath = `${tmp}/db-${runId}.sqlite`;
const zipPath = `${tmp}/${runId}.zip`;
let db: Database;
let client: Client;

beforeAll(async () => {
  await Bun.write(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
  );
  await runImport(dbPath, zipPath);
  db = openDb(dbPath);

  const server = createMcpServer({ db });
  client = new Client({ name: "midori-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(() => {
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

interface ImportRow {
  id: number;
  status: string;
  recordsSeen: number;
}
interface SourceRow {
  name: string;
  recordCount: number;
}
interface FindingRow {
  kind: string;
  metric: string;
  sourceName: string;
  anchorDay: string;
}
interface DailySeries {
  sourceName: string;
  trust: string;
  trustNote: string;
  asOfDay: string;
  points: Array<{ day: string; value: number }>;
}
interface DeviationRow {
  metric: string;
  z: number | null;
  trust: string;
  suppressed: string | null;
}

async function call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await client.callTool({ name: tool, arguments: args });
  const content = res.content;
  if (!Array.isArray(content) || content.length === 0) throw new Error(`no content from ${tool}`);
  const first = content[0];
  if (!first || first.type !== "text") throw new Error(`non-text content from ${tool}`);
  return JSON.parse(first.text) as T;
}

describe("MCP tools over an imported spike corpus", () => {
  test("briefing tells the full story in one call", async () => {
    const b = await call<{
      anchorDay: string;
      asOf: Record<string, { sourceName: string; day: string }>;
      findings: FindingRow[];
      sources: SourceRow[];
      lastImport: ImportRow | null;
      importCadenceHint: string | null;
    }>("briefing");
    expect(b.anchorDay).toBe(SPIKE_ANCHOR);
    expect(b.asOf.wrist_temp).toEqual({ sourceName: SOURCE_B, day: SPIKE_ANCHOR });
    expect(b.findings.some((f) => f.kind === "coverage" && f.metric === "wrist_temp")).toBe(true);
    expect(b.lastImport?.status).toBe("done");
    expect(b.importCadenceHint).toBeNull();
  });

  test("list_imports + list_sources", async () => {
    const imports = await call<ImportRow[]>("list_imports");
    expect(imports.length).toBe(1);
    expect(imports[0]?.status).toBe("done");
    expect(imports[0]?.recordsSeen).toBeGreaterThan(0);

    const sources = await call<SourceRow[]>("list_sources");
    expect(sources.length).toBe(2);
    for (const s of sources) expect(s.recordCount).toBeGreaterThan(0);
  });

  test("metric_daily: trust + as-of travel with the series", async () => {
    const series = await call<DailySeries[]>("metric_daily", { metric: "wrist_temp" });
    const b = series.find((s) => s.sourceName === SOURCE_B);
    expect(b?.trust).toBe("moderate");
    expect(b?.trustNote.length ?? 0).toBeGreaterThan(0);
    expect(b?.asOfDay).toBe(SPIKE_ANCHOR);
    expect(b?.points.length).toBe(14);
    // source A series stops at the seam
    expect(series.find((s) => s.sourceName !== SOURCE_B)?.asOfDay).toBe(SPIKE_WINDOWS.baselineEnd);
  });

  test("metric_daily unknown metric -> isError with known list", async () => {
    const res = await client.callTool({
      name: "metric_daily",
      arguments: { metric: "not_a_metric" },
    });
    expect(res.isError).toBe(true);
  });

  test("deviations: no wrist-temp z at/above 2.5; trust on every row", async () => {
    const rows = await call<DeviationRow[]>("deviations", { days: 14 });
    for (const r of rows.filter((x) => x.metric === "wrist_temp")) {
      if (r.z !== null) expect(Math.abs(r.z)).toBeLessThan(2.5);
    }
    expect(rows.every((r) => ["high", "moderate", "low"].includes(r.trust))).toBe(true);
  });

  test("findings since= filters by anchor day", async () => {
    const all = await call<FindingRow[]>("findings");
    expect(all.length).toBeGreaterThan(0);
    const since = SPIKE_WINDOWS.recentStart;
    const recent = await call<FindingRow[]>("findings", { since });
    expect(recent.length).toBeLessThan(all.length);
    expect(recent.length).toBeGreaterThan(0);
    for (const f of recent) {
      expect(f.anchorDay >= since).toBe(true);
    }
  });
});
