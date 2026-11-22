import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import type { FindingsDiffClassification } from "../domain/api";
import { buildDiff, getImportDiff, insertSnapshotRows, latestSinceLastImport } from "./diff";

type Seed = {
  metric: string;
  state: "computed" | "warming_up" | "insufficient" | "stale";
  severity: "within" | "notable" | "alert" | null;
  z: number | null;
  direction: "higher" | "lower" | "within" | null;
};

function makeDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

function importRow(db: Database, id: number, asof: string, status = "done"): void {
  db.run(
    `INSERT INTO imports (id, created_at, zip_name, zip_size, status, as_of_day)
     VALUES (?, '2026-11-01T00:00:00Z', ?, 1, ?, ?)`,
    [id, `export-${id}.zip`, status, asof],
  );
}

function snapshot(db: Database, id: number, asof: string, rows: Seed[]): void {
  insertSnapshotRows(
    db,
    id,
    rows.map((row) => ({ ...row, confidence: "high", asof_day: asof })),
  );
}

function classify(prev: Seed, curr: Seed): FindingsDiffClassification | null {
  const db = makeDb();
  importRow(db, 1, "2026-11-01");
  importRow(db, 2, "2026-11-08");
  snapshot(db, 1, "2026-11-01", [prev]);
  snapshot(db, 2, "2026-11-08", [curr]);
  const diff = buildDiff(db, 1, 2);
  db.close();
  if (!diff) throw new Error("expected a diff");
  return diff.items[0]?.classification ?? null;
}

const computed = (
  severity: "within" | "notable" | "alert",
  z: number,
  direction: "higher" | "lower" | "within",
): Seed => ({ metric: "hrv_sdnn", state: "computed", severity, z, direction });

describe("B-F15 classification priority", () => {
  test("1. direction_reversed wins before every other rule", () => {
    expect(classify(computed("alert", 3.1, "higher"), computed("alert", -3.4, "lower"))).toBe(
      "direction_reversed",
    );
    // Same-side, larger |z| would otherwise be shifted_further.
    expect(classify(computed("notable", 1.6, "higher"), computed("alert", 3.4, "lower"))).toBe(
      "direction_reversed",
    );
  });

  test("2. newly_notable covers any prior non-computed or within state", () => {
    expect(classify(computed("within", 0.4, "within"), computed("notable", 1.8, "lower"))).toBe(
      "newly_notable",
    );
    expect(
      classify(
        { metric: "hrv_sdnn", state: "warming_up", severity: "within", z: null, direction: null },
        computed("alert", 2.7, "lower"),
      ),
    ).toBe("newly_notable");
    expect(
      classify(
        { metric: "hrv_sdnn", state: "insufficient", severity: "within", z: null, direction: null },
        computed("notable", 1.9, "higher"),
      ),
    ).toBe("newly_notable");
  });

  test("3. returned_to_usual requires computed on both sides", () => {
    expect(classify(computed("alert", -2.8, "lower"), computed("within", -0.6, "within"))).toBe(
      "returned_to_usual",
    );
    // A notable metric that loses its baseline (warming_up/insufficient) is not "usual".
    expect(
      classify(computed("alert", -2.8, "lower"), {
        metric: "hrv_sdnn",
        state: "warming_up",
        severity: "within",
        z: null,
        direction: null,
      }),
    ).toBeNull();
    expect(
      classify(computed("alert", -2.8, "lower"), {
        metric: "hrv_sdnn",
        state: "insufficient",
        severity: "within",
        z: null,
        direction: null,
      }),
    ).toBeNull();
  });

  test("4. shifted_further needs escalation or |z| moving further out on the same side", () => {
    expect(classify(computed("notable", -1.7, "lower"), computed("alert", -2.9, "lower"))).toBe(
      "shifted_further",
    );
    expect(classify(computed("notable", -1.6, "lower"), computed("notable", -2.2, "lower"))).toBe(
      "shifted_further",
    );
    // Moderating toward baseline stays unchanged, even with |Δz| >= 0.5.
    expect(
      classify(computed("alert", 3.0, "higher"), computed("notable", 2.2, "higher")),
    ).toBeNull();
    expect(
      classify(computed("notable", 2.4, "higher"), computed("notable", 1.7, "higher")),
    ).toBeNull();
  });

  test("5. baseline_ready covers warming_up/insufficient to computed within", () => {
    expect(
      classify(
        { metric: "wrist_temp", state: "warming_up", severity: "within", z: null, direction: null },
        {
          metric: "wrist_temp",
          state: "computed",
          severity: "within",
          z: 0.3,
          direction: "within",
        },
      ),
    ).toBe("baseline_ready");
    expect(
      classify(
        {
          metric: "wrist_temp",
          state: "insufficient",
          severity: "within",
          z: null,
          direction: null,
        },
        {
          metric: "wrist_temp",
          state: "computed",
          severity: "within",
          z: -0.4,
          direction: "within",
        },
      ),
    ).toBe("baseline_ready");
    // A newly notable metric is newly_notable, not baseline_ready.
    expect(
      classify(
        { metric: "wrist_temp", state: "warming_up", severity: "within", z: null, direction: null },
        {
          metric: "wrist_temp",
          state: "computed",
          severity: "notable",
          z: 1.7,
          direction: "higher",
        },
      ),
    ).toBe("newly_notable");
  });
});

describe("B-F15 diff shape", () => {
  test("builds neutral items, counts unchanged pairs, and carries kinds", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-01");
    importRow(db, 2, "2026-11-08");
    snapshot(db, 1, "2026-11-01", [
      computed("within", 0.2, "within"),
      { metric: "steps", state: "computed", severity: "within", z: 0.5, direction: "within" },
      { metric: "sleep_h", state: "computed", severity: "notable", z: 1.8, direction: "lower" },
    ]);
    snapshot(db, 2, "2026-11-08", [
      computed("alert", 2.9, "lower"),
      { metric: "steps", state: "computed", severity: "within", z: 0.6, direction: "within" },
      { metric: "sleep_h", state: "computed", severity: "notable", z: 1.7, direction: "lower" },
    ]);
    const diff = buildDiff(db, 1, 2);
    expect(diff).toMatchObject({
      fromImportId: 1,
      toImportId: 2,
      fromAsOfDay: "2026-11-01",
      toAsOfDay: "2026-11-08",
      unchangedCount: 2,
    });
    expect(diff?.items).toEqual([
      {
        metric: "hrv_sdnn",
        kind: "overnight",
        classification: "newly_notable",
        previous: {
          state: "computed",
          severity: "within",
          direction: "within",
          z: 0.2,
          confidence: "high",
        },
        current: {
          state: "computed",
          severity: "alert",
          direction: "lower",
          z: 2.9,
          confidence: "high",
        },
      },
    ]);
    db.close();
  });
});

describe("B-F15 target selection and guards", () => {
  const seeds: Seed[] = [computed("within", 0.2, "within")];

  test("returns null for missing, failed, or snapshot-less imports", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-01");
    snapshot(db, 1, "2026-11-01", seeds);
    importRow(db, 2, "2026-11-08", "failed");
    expect(getImportDiff(db, 99)).toBeNull();
    expect(getImportDiff(db, 2)).toBeNull();
    db.close();
  });

  test("B-I3/B-I4 guard: an earlier done import already at this as-of returns null", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-08");
    snapshot(db, 1, "2026-11-08", seeds);
    importRow(db, 2, "2026-11-08");
    snapshot(db, 2, "2026-11-08", seeds);
    expect(getImportDiff(db, 2)).toBeNull();

    const older = makeDb();
    importRow(older, 1, "2026-11-10");
    snapshot(older, 1, "2026-11-10", seeds);
    importRow(older, 2, "2026-11-04");
    snapshot(older, 2, "2026-11-04", seeds);
    expect(getImportDiff(older, 2)).toBeNull();
    db.close();
    older.close();
  });

  test("compares against the most recent prior snapshot with a strictly earlier as-of", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-01");
    snapshot(db, 1, "2026-11-01", [computed("notable", 1.8, "lower")]);
    importRow(db, 2, "2026-11-04");
    snapshot(db, 2, "2026-11-04", [computed("alert", 2.8, "lower")]);
    importRow(db, 3, "2026-11-08");
    snapshot(db, 3, "2026-11-08", [computed("within", 0.4, "within")]);
    expect(getImportDiff(db, 3)).toMatchObject({
      fromImportId: 2,
      toImportId: 3,
      items: [{ classification: "returned_to_usual" }],
    });
    db.close();
  });

  test("sinceLastImport compares the latest done snapshot to the prior earlier one", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-01");
    snapshot(db, 1, "2026-11-01", [computed("within", 0.2, "within")]);
    importRow(db, 2, "2026-11-05");
    snapshot(db, 2, "2026-11-05", [computed("notable", 1.9, "lower")]);
    // A duplicate import (B-I3) at the same as-of must not become the diff base.
    importRow(db, 3, "2026-11-05");
    snapshot(db, 3, "2026-11-05", [computed("notable", 1.9, "lower")]);
    expect(latestSinceLastImport(db)).toMatchObject({
      fromImportId: 1,
      toImportId: 3,
      fromAsOfDay: "2026-11-01",
      toAsOfDay: "2026-11-05",
      items: [{ metric: "hrv_sdnn", classification: "newly_notable" }],
    });
    db.close();
  });

  test("sinceLastImport is null with fewer than two snapshots", () => {
    const db = makeDb();
    importRow(db, 1, "2026-11-01");
    snapshot(db, 1, "2026-11-01", seeds);
    expect(latestSinceLastImport(db)).toBeNull();
    db.close();
  });
});
