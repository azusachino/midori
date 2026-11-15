import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { derive } from "./derive";

describe("atomic derive", () => {
  test("B-I5 keeps the previous derived snapshot when a mid-derive stage throws", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
       VALUES ('previous', 'Watch0,1', 'watch', '2025-01-01', '2025-01-02', 2)`,
    ).run();
    db.prepare(
      `INSERT INTO nights (date, zone, asleep_s) VALUES ('2025-01-01', 'UTC', 25200)`,
    ).run();
    db.prepare(
      `INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES ('sleep_h', 1, '2025-01-01', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
       VALUES ('sleep_h', 1, '2025-01-01', 'night', 7, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO findings (metric, state, asof_day, stint_id) VALUES ('sleep_h', 'computed', '2025-01-01', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO epoch_events (epoch_id, day, kind, detail) VALUES (1, '2025-01-02', 'os_update', 'old')`,
    ).run();
    db.prepare(
      `INSERT INTO seam_steps (metric, seam_day, kind, value, n_old, n_new)
       VALUES ('sleep_h', '2025-01-01', 'step', 1, 7, 7)`,
    ).run();

    expect(() =>
      derive(db, {
        afterStage: (stage) => {
          if (stage === "baselines") throw new Error("injected derive failure");
        },
      }),
    ).toThrow("injected derive failure");
    expect(db.query("SELECT source_name AS sourceName FROM epochs").all()).toEqual([
      { sourceName: "previous" },
    ]);
    expect(db.query("SELECT date FROM nights").all()).toEqual([{ date: "2025-01-01" }]);
    expect(db.query("SELECT value FROM metric_values").all()).toEqual([{ value: 7 }]);
    expect(db.query("SELECT state FROM findings").all()).toEqual([{ state: "computed" }]);
    expect(db.query("SELECT day FROM epoch_events").all()).toEqual([{ day: "2025-01-02" }]);
    expect(db.query("SELECT seam_day AS seamDay FROM seam_steps").all()).toEqual([
      { seamDay: "2025-01-01" },
    ]);
    expect(db.query("SELECT start_day AS startDay FROM stints").all()).toEqual([
      { startDay: "2025-01-01" },
    ]);
    db.close();
  });
});
