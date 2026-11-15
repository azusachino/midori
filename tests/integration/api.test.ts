import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { runImport } from "../../src/ingest/import";
import { SOURCE_A, SOURCE_B, SPIKE_ANCHOR, spike } from "../fixtures";
import { buildStoredZip } from "../util/mkzip";

/**
 * Design-required integration test (T13): fixture zip -> db -> HTTP read routes.
 * Uses the spike corpus: the read surface must tell the wrist-temp story
 * (seam findings, as-of per metric, trust labels) without ever exposing a
 * cross-source z.
 */

const tmp = resolve(import.meta.dir, "../../.tmp-integration-test");
const runId = randomUUID().slice(0, 8);

const dbPath = `${tmp}/db-${runId}.sqlite`;
const zipPath = `${tmp}/${runId}.zip`;
let db: Database;

beforeAll(async () => {
  await Bun.write(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: spike.xml }]),
  );
  await runImport(dbPath, zipPath);
  db = openDb(dbPath);
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

const app = () => createApp({ db });

describe("read routes over an imported spike corpus", () => {
  test("legacy source-boundary evidence does not assert a device takeover", async () => {
    const result = db
      .prepare(`INSERT INTO findings
      (import_id, anchor_day, kind, metric, source_name, window_days, severity, evidence, created_at)
      VALUES (1, '2026-03-01', 'recalibration', 'wrist_temp', 'legacy', 14, 'info', ?, ?)`)
      .run(
        JSON.stringify([
          {
            kind: "source_span",
            detail: "took over from another source; cross-device offsets reset",
          },
        ]),
        new Date().toISOString(),
      );
    try {
      const res = await app().request("/api/findings");
      const text = await res.text();
      expect(text).toContain("a device change is not established");
      expect(text).not.toContain("took over from");
    } finally {
      db.prepare("DELETE FROM findings WHERE id = ?").run(result.lastInsertRowid);
    }
  });

  test("GET /api/imports lists the completed import", async () => {
    const res = await app().request("/api/imports");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBe(1);
    expect(body[0]?.status).toBe("done");
    expect(body[0]?.recordsSeen).toBeGreaterThan(0);
    expect(body[0]?.zipName).toBe(`${runId}.zip`);
  });

  test("GET /api/sources returns both watches with counts", async () => {
    const res = await app().request("/api/sources");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ name: string; recordCount: number }>;
    expect(rows.map((r) => r.name).sort()).toEqual([SOURCE_A, SOURCE_B].sort());
    for (const r of rows) expect(r.recordCount).toBeGreaterThan(0);
  });

  test("GET /api/briefing: as-of per metric, seam findings, no cross-source z", async () => {
    const res = await app().request("/api/briefing");
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      anchorDay: string;
      asOf: Record<string, { sourceName: string; day: string }>;
      findings: Array<{ kind: string; metric: string; sourceName: string }>;
      sources: Array<{ name: string }>;
      lastImport: Record<string, unknown> | null;
      importCadenceHint: string | null;
    };
    expect(b.anchorDay).toBe(SPIKE_ANCHOR);
    expect(b.asOf.wrist_temp).toEqual({ sourceName: SOURCE_B, day: SPIKE_ANCHOR });
    expect(b.findings.length).toBeGreaterThan(0);
    expect(b.findings.some((f) => f.kind === "coverage" && f.metric === "wrist_temp")).toBe(true);
    expect(b.lastImport).not.toBeNull();
    expect(b.importCadenceHint).toBeNull(); // import just happened
  });

  test("GET /api/deviations ranks and never shows a mixed-source z", async () => {
    const res = await app().request("/api/deviations?days=14");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      metric: string;
      z: number | null;
      suppressed: string | null;
      trust: string;
    }>;
    // spike invariant: no wrist-temp deviation survives at |z| >= 2.5
    for (const r of rows.filter((x) => x.metric === "wrist_temp")) {
      if (r.z !== null) expect(Math.abs(r.z)).toBeLessThan(2.5);
    }
    expect(rows.every((r) => ["high", "moderate", "low"].includes(r.trust))).toBe(true);
    // ranking: non-null z before null z
    const firstNull = rows.findIndex((r) => r.z === null);
    if (firstNull !== -1) {
      expect(rows.slice(firstNull).every((r) => r.z === null)).toBe(true);
    }
  });

  test("GET /api/metrics/wrist_temp/daily returns per-source series with trust", async () => {
    const res = await app().request("/api/metrics/wrist_temp/daily");
    expect(res.status).toBe(200);
    const series = (await res.json()) as Array<{
      sourceName: string;
      unit: string;
      method: string;
      trust: string;
      trustNote: string;
      asOfDay: string;
      points: Array<{ day: string; value: number; sampleCount: number }>;
    }>;
    expect(series.length).toBe(2);
    const b = series.find((s) => s.sourceName === SOURCE_B);
    expect(b?.unit).toBe("degC");
    expect(b?.method).toBe("median");
    expect(b?.trust).toBe("moderate");
    expect(b?.trustNote.length ?? 0).toBeGreaterThan(0);
    expect(b?.points.length).toBe(14);
    expect(b?.asOfDay).toBe(SPIKE_ANCHOR);
    const firstDay = b?.points[0]?.day ?? "";
    const lastDay = b?.points.at(-1)?.day ?? "";
    expect(firstDay < lastDay).toBe(true); // ascending day order
  });

  test("unknown metric -> 404 typed error; known-but-empty -> 200 []", async () => {
    const notFound = await app().request("/api/metrics/not_a_metric/daily");
    expect(notFound.status).toBe(404);
    const err = (await notFound.json()) as { error: string; retryable: boolean };
    expect(err.error).toContain("unknown metric");
    expect(err.retryable).toBe(false);

    const empty = await app().request("/api/metrics/sleep_h/daily");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });

  test("invalid days param -> 400 typed error", async () => {
    const res = await app().request("/api/deviations?days=0");
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string; retryable: boolean };
    expect(err.retryable).toBe(false);
  });
});
