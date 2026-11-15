import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { buildFixture, type ExportSpec, type RecordSpec, TYPE } from "../../tests/fixtures/model";
import { SOURCE_A, SOURCE_B, spikeSpec } from "../../tests/fixtures/spike";
import { buildStoredZip } from "../../tests/util/mkzip";
import { openDb } from "../db/db";
import type { EvidenceRef, Finding } from "../domain/types";
import { runImport } from "../ingest/import";
import { computeFindings } from "./findings";

const tmp = resolve(import.meta.dir, "../../.tmp-findings-test");
const runId = randomUUID().slice(0, 8);

interface ParsedFinding extends Finding {
  importId: number;
  createdAt: string;
}

function persistedFindings(db: Database, where = ""): ParsedFinding[] {
  const raw = db
    .prepare(
      `SELECT kind, metric, source_name AS sourceName, anchor_day AS anchorDay,
              window_days AS windowDays, baseline, recent, unit, z, severity,
              evidence, import_id AS importId, created_at AS createdAt
       FROM findings ${where}`,
    )
    .all() as Array<Record<string, unknown>>;
  return raw.map((r) => ({
    ...(r as unknown as Omit<ParsedFinding, "evidence">),
    evidence: JSON.parse(String(r.evidence)) as EvidenceRef[],
  }));
}

async function importSpec(spec: ExportSpec, name: string): Promise<string> {
  const dbPath = `${tmp}/db-${runId}-${name}.sqlite`;
  const zipPath = `${tmp}/${runId}-${name}.zip`;
  await Bun.write(
    zipPath,
    buildStoredZip([
      { name: "apple_health_export/export.xml", data: buildFixture("t", spec, {}).xml },
    ]),
  );
  await runImport(dbPath, zipPath);
  return dbPath;
}

afterAll(() => {
  for (const name of ["spike", "abut"]) {
    for (const p of [
      `${tmp}/db-${runId}-${name}.sqlite`,
      `${tmp}/db-${runId}-${name}.sqlite-wal`,
      `${tmp}/db-${runId}-${name}.sqlite-shm`,
      `${tmp}/${runId}-${name}.zip`,
    ]) {
      try {
        unlinkSync(p);
      } catch {
        // absent — fine
      }
    }
  }
});

beforeAll(async () => {
  await Bun.write(`${tmp}/.keep`, "");
});

describe("spike regression: two-source wrist-temp swap (15-day hole -> gap seam)", () => {
  let dbPath: string;

  beforeAll(async () => {
    dbPath = await importSpec(spikeSpec(), "spike");
  });

  test("fixture zip imports and produces daily rows per source (never merged)", () => {
    const db = openDb(dbPath);
    const sources = db
      .prepare(
        `SELECT DISTINCT source_name FROM daily_metrics WHERE metric = 'wrist_temp' ORDER BY source_name`,
      )
      .all() as Array<{ source_name: string }>;
    expect(sources.map((s) => s.source_name).sort()).toEqual([SOURCE_A, SOURCE_B].sort());
    db.close();
  });

  test("no cross-source +4 sigma anywhere: B suppressed, A computes only its own series", () => {
    const db = openDb(dbPath);
    const { rows, findings } = computeFindings(db);
    const wrist = rows.filter((r) => r.metric === "wrist_temp");
    expect(wrist.length).toBe(2);
    const b = wrist.find((r) => r.sourceName === SOURCE_B);
    expect(b?.suppressed).not.toBeNull();
    expect(b?.z).toBeNull();
    // A's row is per-source: its own stable series may compute a small z,
    // but a cross-source jump must never appear as a z
    const a = wrist.find((r) => r.sourceName === SOURCE_A);
    expect(Math.abs(a?.z ?? 0)).toBeLessThan(1.5);
    for (const r of wrist) {
      if (r.z !== null) expect(Math.abs(r.z)).toBeLessThan(2.5);
    }
    // and no wrist_temp deviation finding was persisted from mixed sources
    const dev = findings.filter((f) => f.kind === "deviation" && f.metric === "wrist_temp");
    expect(dev.length).toBe(0);
    db.close();
  });

  test("seam surfaces as a coverage finding (gap) with counterpart detail", () => {
    const db = openDb(dbPath);
    const gaps = persistedFindings(db, "WHERE kind = 'coverage'").filter(
      (f) => f.metric === "wrist_temp",
    );
    expect(gaps.length).toBeGreaterThan(0);
    const seam = gaps.find((g) => g.sourceName === SOURCE_B);
    expect(seam).toBeDefined();
    expect(seam?.evidence[0]?.detail).toContain("gap after");
    db.close();
  });

  test("device events: first_seen for both sources, last_seen for the retired one", () => {
    const db = openDb(dbPath);
    const kinds = db
      .prepare(`SELECT kind, source_name FROM device_events ORDER BY kind, source_name`)
      .all() as Array<{
      kind: string;
      source_name: string;
    }>;
    expect(kinds.some((e) => e.kind === "first_seen" && e.source_name === SOURCE_A)).toBe(true);
    expect(kinds.some((e) => e.kind === "first_seen" && e.source_name === SOURCE_B)).toBe(true);
    // global last data day comes from SOURCE_B; SOURCE_A stopped earlier -> last_seen
    expect(kinds.some((e) => e.kind === "last_seen" && e.source_name === SOURCE_A)).toBe(true);
    expect(kinds.some((e) => e.kind === "last_seen" && e.source_name === SOURCE_B)).toBe(false);
    db.close();
  });

  test("findings are persisted by import completion and stable across recompute", () => {
    const db = openDb(dbPath);
    const persisted = db.prepare(`SELECT COUNT(*) n FROM findings`).get() as { n: number };
    expect(persisted.n).toBeGreaterThan(0);
    const rows = db.prepare(`SELECT * FROM findings ORDER BY kind, metric, source_name`).all();
    // recompute (as the next import would) yields the identical ledger
    const { findings } = computeFindings(db);
    expect(findings.length).toBe(rows.length);
    db.close();
  });
});

describe("abutting seam: switch -> recalibration finding + cross_source suppression", () => {
  let dbPath: string;

  beforeAll(async () => {
    const ANCHOR = "2026-03-01";
    const temp = (source: string, day: string, value: string): RecordSpec => ({
      type: TYPE.wristTemp,
      sourceName: source,
      unit: "degC",
      startDate: `${day} 03:00:00 +0900`,
      endDate: `${day} 03:00:00 +0900`,
      value,
    });
    const records: RecordSpec[] = [];
    // A: -90..-1 (90 days, anchor -1: baseline AND recent windows both full)
    for (let o = -90; o <= -1; o++) {
      const day = offsetDay(ANCHOR, o);
      records.push(temp(SOURCE_A, day, (34.0 + ((o * 7) % 5) * 0.01).toFixed(2)));
    }
    // B: 0..0 (takes over the very next day — abutting seam -> switch)
    records.push(temp(SOURCE_B, ANCHOR, "36.00"));
    dbPath = await importSpec(
      { exportDate: "2026-03-02 08:00:00 +0900", records, workouts: [] },
      "abut",
    );
  });

  test("switch device event emitted at the seam with counterpart", () => {
    const db = openDb(dbPath);
    const switches = db
      .prepare(`SELECT * FROM device_events WHERE kind = 'switch' AND metric = 'wrist_temp'`)
      .all() as Array<{ source_name: string; occurred_on: string; details: string | null }>;
    expect(switches.length).toBe(1);
    expect(switches[0]?.source_name).toBe(SOURCE_B);
    expect(switches[0]?.occurred_on).toBe("2026-03-01");
    expect(switches[0]?.details).toContain(SOURCE_A);
    db.close();
  });

  test("recalibration finding persisted for the seam", () => {
    const db = openDb(dbPath);
    const recal = persistedFindings(db, "WHERE kind = 'recalibration' AND metric = 'wrist_temp'");
    expect(recal.length).toBe(1);
    expect(recal[0]?.sourceName).toBe(SOURCE_B);
    expect(recal[0]?.evidence[0]?.detail).toContain("a device change is not established");
    db.close();
  });

  test("B's row is suppressed cross_source (recalibrating), A's own z stands", () => {
    const db = openDb(dbPath);
    const { rows } = computeFindings(db);
    const b = rows.find((r) => r.metric === "wrist_temp" && r.sourceName === SOURCE_B);
    const a = rows.find((r) => r.metric === "wrist_temp" && r.sourceName === SOURCE_A);
    expect(b?.suppressed).toBe("cross_source");
    expect(b?.z).toBeNull();
    // A's window [-91, -1] does not contain the seam day (03-01) -> its z is computed
    expect(a?.suppressed).toBeNull();
    expect(a?.z).not.toBeNull();
    db.close();
  });
});

function offsetDay(anchor: string, offset: number): string {
  const t = Date.parse(`${anchor}T00:00:00Z`) + offset * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
