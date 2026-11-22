import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { METRICS } from "../domain/metrics";
import { deriveChecks } from "./checks";

function makeDb() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
     VALUES ('watch', 'Watch1,1', 'watch', '2026-01-01', '2026-01-20', 20)`,
  ).run();
  db.prepare(
    `INSERT INTO nights (date, zone, tz_change, partial_reason) VALUES
     ('2026-01-01', 'UTC', 1, 'export_cut'), ('2026-01-15', 'UTC', 0, NULL),
     ('2026-01-16', 'UTC', 0, NULL), ('2026-01-17', 'UTC', 0, NULL),
     ('2026-01-18', 'UTC', 0, NULL), ('2026-01-19', 'UTC', 0, NULL),
     ('2026-01-20', 'UTC', 0, NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES
     ('wrist_temp', 1, '2026-01-01', '2026-01-09'),
     ('wrist_temp', 1, '2026-01-10', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
     VALUES ('wrist_temp', 1, '2026-01-01', 'night', 1, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO seam_steps (metric, seam_day, kind, value, n_old, n_new)
     VALUES ('wrist_temp', '2026-01-10', 'step', 1, 7, 7)`,
  ).run();
  db.prepare(
    `INSERT INTO epoch_events (epoch_id, day, kind, detail)
     VALUES (1, '2026-01-11', 'os_update', '26.0 → 26.1')`,
  ).run();
  return db;
}

function metric(key: string) {
  const spec = METRICS[key];
  if (!spec) throw new Error(`missing metric spec: ${key}`);
  return spec;
}

const days = [
  "2026-01-20",
  "2026-01-19",
  "2026-01-18",
  "2026-01-17",
  "2026-01-16",
  "2026-01-15",
  "2026-01-01",
];

describe("finding checks", () => {
  test("B-C1–B-C7 all return clear when no confound applies", () => {
    const db = makeDb();
    db.exec(
      "DELETE FROM seam_steps; DELETE FROM epoch_events; DELETE FROM metric_values; DELETE FROM stints WHERE start_day = '2026-01-10'; UPDATE nights SET partial_reason = NULL, tz_change = 0",
    );
    const checks = deriveChecks(
      db,
      "wrist_temp",
      1,
      "2026-01-20",
      metric("wrist_temp"),
      days.slice(0, 6).concat("2026-01-14"),
    );
    expect(checks).toHaveLength(7);
    expect(checks.every((check) => !check.flagged)).toBe(true);
    db.close();
  });

  test("B-C1–B-C7 flag recent seams, OS updates, partials, timezone, gaps, low trust and notes", () => {
    const db = makeDb();
    const checks = deriveChecks(db, "wrist_temp", 1, "2026-01-20", metric("active_kj"), days);
    expect(checks.map(({ key, flagged }) => [key, flagged])).toEqual([
      ["device_change", true],
      ["os_update", true],
      ["partial_nights", true],
      ["tz_change", true],
      ["missing_nights", true],
      ["low_trust", true],
      ["user_note", false],
    ]);
    db.close();
  });

  test("B-C7 flags an overlapping note, counts it, and clamps its day into the recent window", () => {
    const db = makeDb();
    db.run(
      `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at) VALUES
       ('2026-01-02', '2026-01-18', 'travel', 'trip', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
       ('2026-01-17', '2026-01-19', 'stress', 'busy week', '2026-01-17T00:00:00Z', '2026-01-17T00:00:00Z'),
       ('2025-12-01', '2025-12-10', 'illness', 'old', '2025-12-01T00:00:00Z', '2025-12-01T00:00:00Z')`,
    );
    const recent = ["2026-01-15", "2026-01-16", "2026-01-17", "2026-01-18", "2026-01-19"];
    const checks = deriveChecks(db, "wrist_temp", 1, "2026-01-20", metric("wrist_temp"), recent);
    const note = checks.find((check) => check.key === "user_note");
    // Two notes overlap the clamped [2026-01-15, 2026-01-19] window; the latest starts 01-17.
    expect(note).toEqual({ key: "user_note", flagged: true, day: "2026-01-17", count: 2 });

    // A note starting before the recent window links to oldestRecentDay, never outside it.
    db.run("DELETE FROM notes WHERE id <> 1");
    const clamped = deriveChecks(
      db,
      "wrist_temp",
      1,
      "2026-01-20",
      metric("wrist_temp"),
      recent,
    ).find((check) => check.key === "user_note");
    expect(clamped).toEqual({ key: "user_note", flagged: true, day: "2026-01-15", count: 1 });
    db.close();
  });
});
