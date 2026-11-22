import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { CONTEXT_DEFAULT_DAYS, getHealthContext, isValidContextDays } from "./context";
import { saveProfileContext } from "./profile";

const AS_OF = "2026-03-10";
/** Ten consecutive nights ending on the as-of day, oldest first. */
const NIGHTS = Array.from({ length: 10 }, (_, index) => addDays(AS_OF, -(9 - index)));

/** 8 usable hrv values inside 90d, 2 unusable days, plus 2 older usable values. */
const HRV_VALUES: ReadonlyArray<{ day: string; value: number; usable: number }> = [
  { day: "2026-03-01", value: 40, usable: 1 },
  { day: "2026-03-02", value: 41, usable: 1 },
  { day: "2026-03-03", value: 42, usable: 1 },
  { day: "2026-03-04", value: 43, usable: 1 },
  { day: "2026-03-05", value: 99, usable: 0 },
  { day: "2026-03-06", value: 44, usable: 1 },
  { day: "2026-03-07", value: 99, usable: 0 },
  { day: "2026-03-08", value: 45, usable: 1 },
  { day: "2026-03-09", value: 46, usable: 1 },
  { day: "2026-03-10", value: 47, usable: 1 },
  { day: "2026-01-15", value: 50, usable: 1 },
  { day: "2025-10-01", value: 60, usable: 1 },
];

const OVERNIGHT_KEYS = Object.values(METRICS)
  .filter((spec) => spec.kind === "overnight")
  .map((spec) => spec.key)
  .sort();

function makeDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-03-10T00:00:00Z', 'context.zip', 1, 'done')`,
  ).run();
  db.prepare(
    `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES
     ('Watch A', 'Watch6,1', 'watch', '2025-01-01', '2025-12-31', 365),
     ('Watch B', 'Watch7,5', 'watch', '2026-01-01', '2026-03-10', 69)`,
  ).run();
  db.prepare(
    `INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES
     ('hrv_sdnn', 1, '2025-01-01', '2025-08-31'),
     ('hrv_sdnn', 2, '2025-09-01', NULL),
     ('sleep_h', 2, '2025-11-01', NULL)`,
  ).run();

  const metric = db.prepare(
    `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
     VALUES (?, ?, ?, 'night', ?, 10, ?)`,
  );
  // Stale epoch and pre-stint values must never enter the long-term median (ADR 0001).
  metric.run("hrv_sdnn", 1, "2025-06-01", 100, 1);
  metric.run("hrv_sdnn", 2, "2025-08-20", 100, 1);
  for (const row of HRV_VALUES) metric.run("hrv_sdnn", 2, row.day, row.value, row.usable);
  for (const day of NIGHTS) {
    metric.run("sleep_h", 2, day, 7.2, 1);
    metric.run("deep_h", 2, day, 1.2, 1);
    metric.run("rhr", 2, day, 55, day === "2026-03-03" ? 0 : 1);
  }

  const night = db.prepare(
    `INSERT INTO nights (date, zone, tz_change, partial_reason, asleep_s, core_s, deep_s, rem_s, in_bed_s)
     VALUES (?, 'Asia/Tokyo', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const day of NIGHTS) {
    night.run(
      day,
      day === "2026-03-04" ? 1 : 0,
      day === "2026-03-01" ? "export_cut" : null,
      7.2 * 3600,
      4.5 * 3600,
      1.2 * 3600,
      1.5 * 3600,
      8 * 3600,
    );
  }

  db.prepare(
    `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
     VALUES ('2026-03-02', '2026-03-03', 'travel', 'Trip', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z')`,
  ).run();

  db.prepare(
    `INSERT INTO findings (metric, state, z, severity, confidence, onset_day, onset_open,
       recent, baseline, k_outside, checks_json, asof_day, stint_id)
     VALUES ('hrv_sdnn', 'computed', -2.0, 'alert', 'high', '2026-03-01', 0, 43, 55, 2, '[]', ?, 2)`,
  ).run(AS_OF);
  return db;
}

describe("B-A5 context days validation", () => {
  test("accepts only integers from 7 to 30", () => {
    for (const days of [7, 14, 30]) expect(isValidContextDays(days)).toBe(true);
    for (const days of [6, 31, 14.5, Number.NaN, "14", null, undefined])
      expect(isValidContextDays(days)).toBe(false);
  });
});

describe("B-A5 health context dossier", () => {
  test("findings carry human caveats and primary-stint long-term medians", () => {
    const db = makeDb();
    const dossier = getHealthContext(db);
    expect(dossier.asOfDay).toBe(AS_OF);
    expect(dossier.findings).toHaveLength(1);
    const hrv = dossier.findings[0];
    expect(hrv?.metric).toBe("hrv_sdnn");
    // Only epoch 2 units at/after its stint start count: 9 usable inside 90d, 10 inside 1y.
    expect(hrv?.longTerm).toEqual({ median90d: 44, median1y: 44.5, n90d: 9, n1y: 10 });
    expect(hrv?.caveats).toContain("A personal note overlaps the recent window.");
    expect(hrv?.caveats).not.toContain("user_note");
    expect(dossier.summary).toEqual({
      standsOut: 1,
      closeToEdge: 0,
      within: 0,
      other: 0,
      sharedConfounders: ["partial nights", "a timezone change", "a personal note"],
    });
    db.close();
  });

  test("recentNights align sleep, usable primary-stint vitals, timezone, partial data and notes", () => {
    const db = makeDb();
    const dossier = getHealthContext(db);
    expect(dossier.recentNights).toHaveLength(NIGHTS.length);
    expect(dossier.recentNights.map((night) => night.date)).toEqual([...NIGHTS].reverse());

    const newest = dossier.recentNights[0];
    expect(newest?.metrics.hrv_sdnn).toBe(47);
    expect(newest?.metrics.sleep_h).toBe(7.2);
    expect(newest?.metrics.resp_rate).toBeNull();
    expect(Object.keys(newest?.metrics ?? {}).sort()).toEqual(OVERNIGHT_KEYS);
    expect(newest?.sleep).not.toBeNull();
    expect(newest?.sleep?.asleepH).toBeCloseTo(7.2, 6);
    expect(newest?.sleep?.deepH).toBeCloseTo(1.2, 6);
    expect(newest?.sleep?.remH).toBeCloseTo(1.5, 6);
    expect(newest?.sleep?.coreH).toBeCloseTo(4.5, 6);

    const byDate = new Map(dossier.recentNights.map((night) => [night.date, night]));
    expect(byDate.get("2026-03-05")?.metrics.hrv_sdnn).toBeNull();
    expect(byDate.get("2026-03-03")?.metrics.rhr).toBeNull();
    expect(byDate.get("2026-03-04")?.tzChange).toBe(true);
    expect(byDate.get("2026-03-01")?.partialReason).toBe("export_cut");
    expect(byDate.get("2026-03-01")?.notes).toEqual([]);
    expect(byDate.get("2026-03-02")?.notes).toEqual([{ id: 1, category: "travel", label: "Trip" }]);
    expect(byDate.get("2026-03-03")?.notes.map((note) => note.label)).toEqual(["Trip"]);
    expect(byDate.get("2026-03-05")?.notes).toEqual([]);
    db.close();
  });

  test("days trims the window to the newest nights and defaults to 14", () => {
    const db = makeDb();
    expect(CONTEXT_DEFAULT_DAYS).toBe(14);
    expect(getHealthContext(db).recentNights).toHaveLength(NIGHTS.length);
    const week = getHealthContext(db, 7);
    expect(week.recentNights).toHaveLength(7);
    expect(week.recentNights[0]?.date).toBe(AS_OF);
    expect(week.recentNights.at(-1)?.date).toBe("2026-03-04");
    db.close();
  });

  test("includes the owner profile, freshness, primary watch and recent notes", () => {
    const db = makeDb();
    saveProfileContext(db, {
      goals: "Sleep 7.5 h",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    const dossier = getHealthContext(db);
    expect(dossier.profile).toMatchObject({
      goals: "Sleep 7.5 h",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    expect(dossier.primaryWatch).toMatchObject({
      epochId: 2,
      label: "Watch B",
      hardware: "Watch7,5",
    });
    expect(dossier.freshness.asOfDay).toBe(AS_OF);
    expect(dossier.recentNotes.map((note) => note.label)).toEqual(["Trip"]);
    expect(dossier.sinceLastImport).toBeNull();
    expect(dossier.guidance).toContain("midori does not assert causes");
    db.close();
  });

  test("an empty warehouse returns nulls, no findings and no nights", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(getHealthContext(db)).toMatchObject({
      asOfDay: null,
      primaryWatch: null,
      findings: [],
      recentNights: [],
      sinceLastImport: null,
      summary: { standsOut: 0, closeToEdge: 0, within: 0, other: 0, sharedConfounders: [] },
      profile: { goals: "", routine: "", medicalContext: "", updatedAt: null },
    });
    db.close();
  });
});
