import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/db";
import { addDays } from "../domain/dates";
import { computeDeviations, type DeviationRow } from "./baselines";

const tmp = resolve(import.meta.dir, "../../.tmp-baselines-test");
const runId = randomUUID().slice(0, 8);

const paths: string[] = [];

afterAll(() => {
  for (const p of paths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(`${p}${suffix}`);
      } catch {
        // absent — fine
      }
    }
  }
});

function freshDb(): Database {
  const path = `${tmp}/db-${runId}-${paths.length}.sqlite`;
  paths.push(path);
  return openDb(path);
}

const ANCHOR = "2026-03-01";

/** Insert daily rows for one (metric, source), anchoring the series at ANCHOR. */
function seed(
  db: Database,
  metric: string,
  source: string,
  entries: Array<{ offset: number; value: number }>,
): void {
  db.prepare(
    `INSERT INTO imports (id, created_at, zip_name, zip_size, status)
     VALUES (1, '2026-03-02T00:00:00Z', 't.zip', 1, 'done') ON CONFLICT DO NOTHING`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO daily_metrics
       (metric, source_name, day, method, unit, value, sample_count, computed_at, import_id)
     VALUES (?, ?, ?, 'median', 'x', ?, 1, '2026-03-02T00:00:00Z', 1)`,
  );
  for (const e of entries) {
    insert.run(metric, source, addDays(ANCHOR, e.offset), e.value);
  }
}

function rowFor(rows: DeviationRow[], metric: string, source: string): DeviationRow {
  const r = rows.find((x) => x.metric === metric && x.sourceName === source);
  if (!r) throw new Error(`no row for ${metric}/${source}`);
  return r;
}

/** n days from offsetFrom up to offsetTo (offsetFrom <= offsetTo), constant value. */
function flat(offsetFrom: number, offsetTo: number, value: number) {
  const out: Array<{ offset: number; value: number }> = [];
  for (let o = offsetFrom; o <= offsetTo; o++) out.push({ offset: o, value });
  return out;
}

describe("computeDeviations", () => {
  test("median baseline, median recent, robust z, severity bands", () => {
    const db = freshDb();
    // baseline -90..-29: median 50, MAD small; recent -13..0: median 54
    // dispersion = 1.4826 * median(|x-50|) with values 49,50,51 -> MAD(1)*1.4826 -> z ~ 4/1.4826 = 2.7 alert
    seed(
      db,
      "rhr",
      "watch",
      flat(-90, -29, 50).map((e, i) => ({
        offset: e.offset,
        value: e.value + (i % 3 === 0 ? 1 : 0),
      })),
    );
    seed(db, "rhr", "watch", flat(-13, 0, 54));
    const { rows } = computeDeviations(db);
    const r = rowFor(rows, "rhr", "watch");
    expect(r.suppressed).toBeNull();
    expect(r.asOfDay).toBe(ANCHOR);
    expect(r.nBaseline).toBe(62);
    expect(r.nRecent).toBe(14);
    expect(r.baseline).toBe(50);
    expect(r.recent).toBe(54);
    // MAD=0 -> dispersion = range/4 = 0.25 -> z = 16
    expect(r.z).toBeGreaterThan(15);
    expect(r.severity).toBe("alert");
    expect(r.trust).toBe("high");
    db.close();
  });

  test("gates: too few baseline or recent days -> insufficient_data, z null", () => {
    const db = freshDb();
    // only 14 baseline days (gate is 15)
    seed(db, "rhr", "watch", flat(-42, -29, 50));
    seed(db, "rhr", "watch", flat(-13, 0, 60));
    // gates pass baseline but recent only 6 days (gate is 7) on another source
    seed(db, "hrv_sdnn", "band", [...flat(-90, -29, 40), ...flat(-5, 0, 80)]);
    const { rows } = computeDeviations(db);
    const a = rowFor(rows, "rhr", "watch");
    expect(a.suppressed).toBe("insufficient_data");
    expect(a.z).toBeNull();
    expect(a.nBaseline).toBe(14);
    const b = rowFor(rows, "hrv_sdnn", "band");
    expect(b.suppressed).toBe("insufficient_data");
    expect(b.nRecent).toBe(6);
    db.close();
  });

  test("flat baseline: any nonzero shift becomes an alert (dispersion collapses)", () => {
    const db = freshDb();
    seed(db, "spo2", "watch", [...flat(-90, -29, 98), ...flat(-13, 0, 97.9)]);
    const { rows } = computeDeviations(db);
    const r = rowFor(rows, "spo2", "watch");
    expect(r.suppressed).toBeNull();
    expect(r.z).not.toBeNull();
    expect(Math.abs(r.z ?? 0)).toBeGreaterThan(100);
    expect(r.severity).toBe("alert");
    db.close();
  });

  test("anchor is per source: stale source keeps its own last day", () => {
    const db = freshDb();
    // old source stops at ANCHOR-30; new source runs to ANCHOR
    seed(db, "wrist_temp", "old", flat(-90, -30, 34.0));
    seed(db, "wrist_temp", "new", [...flat(-29, -14, 36.0), ...flat(-13, 0, 36.0)]);
    const { rows } = computeDeviations(db);
    const old = rowFor(rows, "wrist_temp", "old");
    const neu = rowFor(rows, "wrist_temp", "new");
    expect(old.asOfDay).toBe(addDays(ANCHOR, -30));
    // per-source anchor: the stale source's own windows are self-contained, so it
    // still computes (flat series, z 0) instead of being starved by the switch
    expect(old.suppressed).toBeNull();
    expect(old.z).toBe(0);
    expect(neu.asOfDay).toBe(ANCHOR);
    expect(neu.suppressed).toBe("insufficient_data"); // 0 baseline days (window -90..-29 has none)
    db.close();
  });

  test("trust labels attach per metric registry", () => {
    const db = freshDb();
    seed(db, "active_kj", "phone", [...flat(-90, -29, 1000), ...flat(-13, 0, 1100)]);
    const { rows } = computeDeviations(db);
    const r = rowFor(rows, "active_kj", "phone");
    expect(r.trust).toBe("low");
    expect(r.trustNote).toContain("Energy expenditure");
    db.close();
  });

  test("sparse windows count only present days", () => {
    const db = freshDb();
    // baseline with every other day missing: 31 present of 62
    const base = flat(-90, -29, 50).filter((_, i) => i % 2 === 0);
    seed(db, "hrv_sdnn", "band", [...base, ...flat(-13, 0, 44)]);
    const { rows } = computeDeviations(db);
    const r = rowFor(rows, "hrv_sdnn", "band");
    expect(r.suppressed).toBeNull();
    expect(r.nBaseline).toBe(31);
    expect(r.nRecent).toBe(14);
    db.close();
  });
});
