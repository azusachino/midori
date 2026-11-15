import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { addDays } from "../domain/dates";
import { classifyConfidence, deriveOnset, rebuildBaselines } from "./baselines";

function makeDb(metric: string, baselineCount: number, recentCount = 7, asOfOffset = 0) {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    "INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES ('watch', 'Watch1,1', 'watch', '2026-01-01', '2026-04-01', 90)",
  ).run();
  const start = "2026-01-01";
  const total = baselineCount + 7;
  const insertStint = db.prepare(
    "INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES (?, 1, ?, NULL)",
  );
  insertStint.run(metric, start);
  insertStint.run("sleep_h", start);
  const insert = db.prepare(
    "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES (?, 1, ?, 'night', ?, 1, 1)",
  );
  for (let i = 0; i < total; i++) {
    const day = addDays(start, i);
    const usable = Number(i < baselineCount || i >= baselineCount + 7 - recentCount);
    db.prepare(
      "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES (?, 1, ?, 'night', ?, 1, ?)",
    ).run(metric, day, i >= baselineCount ? 20 : 10, usable);
    insert.run("sleep_h", day, 7);
  }
  if (asOfOffset) insert.run("sleep_h", addDays(start, total - 1 + asOfOffset), 7);
  return db;
}

function result(db: Database, metric: string) {
  return rebuildBaselines(db).find((row) => row.metric === metric);
}

describe("rolling stint baselines", () => {
  test("B-F1 uses ordinal usable units in the current stint", () => {
    const db = makeDb("wrist_temp", 28);
    db.prepare(
      "UPDATE metric_values SET usable = 0 WHERE metric = 'wrist_temp' AND unit_day IN (?, ?)",
    ).run("2026-01-20", "2026-02-10");
    const row = result(db, "wrist_temp");
    expect(row?.state).toBe("computed");
    expect(row?.baseline).toBe(10);
    expect(row?.recent).toBe(20);
    db.close();
  });

  test("B-F2 returns insufficient below four recent and stale past fourteen days", () => {
    const insufficient = makeDb("steps", 0, 3);
    expect(result(insufficient, "steps")?.state).toBe("insufficient");
    insufficient.close();
    const stale = makeDb("steps", 28, 7, 15);
    expect(result(stale, "steps")?.state).toBe("stale");
    stale.close();
  });

  test("B-F3 warming_up below seven baseline ranks, then early and full baselines", () => {
    const warming = makeDb("wrist_temp", 6);
    expect(result(warming, "wrist_temp")?.state).toBe("warming_up");
    expect(result(warming, "wrist_temp")?.progress).toBe(13);
    warming.close();
    const early = makeDb("wrist_temp", 7);
    expect(result(early, "wrist_temp")?.confidence).toBe("low");
    early.close();
    const full = makeDb("wrist_temp", 14);
    expect(result(full, "wrist_temp")?.state).toBe("computed");
    full.close();
  });

  test("v0 spike regression warms a new stint before calculating within it", () => {
    const warming = makeDb("wrist_temp", 0);
    expect(result(warming, "wrist_temp")?.state).toBe("warming_up");
    expect(result(warming, "wrist_temp")?.z).toBeNull();
    warming.close();

    const db = makeDb("wrist_temp", 7);
    db.query(
      "UPDATE metric_values SET value = 10.1 WHERE metric = 'wrist_temp' AND unit_day >= '2026-01-08'",
    ).run();
    db.prepare(
      "INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present) VALUES ('old watch', 'Watch0,1', 'watch', '2025-01-01', '2025-12-31', 300)",
    ).run();
    db.prepare(
      "INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES ('wrist_temp', 2, '2025-01-01', '2025-12-31')",
    ).run();
    db.prepare(
      "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES ('wrist_temp', 2, '2025-12-31', 'night', 100, 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO seam_steps (metric, seam_day, kind, value, n_old, n_new) VALUES ('wrist_temp', '2026-01-01', 'step', -80, 10, 10)",
    ).run();
    const row = result(db, "wrist_temp");
    expect(row?.state).toBe("computed");
    expect(row?.confidence).toBe("low");
    expect(row?.baseline).toBe(10);
    expect(row?.z).toBeLessThan(4);
    expect(
      db.query("SELECT COUNT(*) AS count FROM seam_steps WHERE metric = 'wrist_temp'").get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  test("baseline inputs stop at the newest usable sleep_h as-of day", () => {
    const db = makeDb("wrist_temp", 7);
    const insert = db.prepare(
      "INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable) VALUES ('wrist_temp', 1, ?, 'night', 100, 1, 1)",
    );
    insert.run("2026-01-15");
    insert.run("2026-01-16");
    insert.run("2026-01-17");
    const row = result(db, "wrist_temp");
    expect(row?.asOfDay).toBe("2026-01-14");
    expect(row?.recent).toBe(20);
    db.close();
  });

  test("B-F4 flat resp baseline uses its floor and caps z at ten", () => {
    const db = makeDb("resp_rate", 28);
    db.query("UPDATE metric_values SET value = 12 WHERE metric = 'resp_rate'").run();
    db.query(
      "UPDATE metric_values SET value = 20 WHERE metric = 'resp_rate' AND unit_day >= '2026-01-29'",
    ).run();
    expect(result(db, "resp_rate")?.z).toBe(10);
    db.close();
  });

  test("B-F6 first-match confidence order covers low, medium and high", () => {
    const lowTrust = makeDb("active_kj", 28);
    expect(result(lowTrust, "active_kj")?.confidence).toBe("low");
    lowTrust.close();
    const baselineLow = makeDb("wrist_temp", 13);
    expect(result(baselineLow, "wrist_temp")?.confidence).toBe("low");
    baselineLow.close();
    const baselineMedium = makeDb("wrist_temp", 23);
    expect(result(baselineMedium, "wrist_temp")?.confidence).toBe("medium");
    baselineMedium.close();
    expect(classifyConfidence("moderate", 28, 5)).toBe("medium");
    const high = makeDb("wrist_temp", 28);
    expect(result(high, "wrist_temp")?.confidence).toBe("high");
    high.close();
  });

  test("B-F8 counts values beyond the baseline band", () => {
    const db = makeDb("wrist_temp", 28);
    expect(result(db, "wrist_temp")?.kOutside).toBe(7);
    db.close();
  });

  test("B-F11 tolerates one inside unit and opens when the run reaches stint start", () => {
    const db = makeDb("wrist_temp", 28);
    db.query(
      "UPDATE metric_values SET value = 10 WHERE metric = 'wrist_temp' AND unit_day = '2026-02-01'",
    ).run();
    const row = result(db, "wrist_temp");
    expect(row?.onsetDay).toBe("2026-01-29");
    expect(row?.onsetOpen).toBe(false);
    db.close();
  });

  test("B-F11 onset may reach the stint start after one tolerated inside unit", () => {
    expect(
      deriveOnset(
        [
          { unitDay: "2026-01-05", value: 20 },
          { unitDay: "2026-01-04", value: 20 },
          { unitDay: "2026-01-03", value: 10 },
          { unitDay: "2026-01-02", value: 20 },
          { unitDay: "2026-01-01", value: 20 },
        ],
        10,
        0.5,
        "2026-01-01",
      ),
    ).toEqual({ day: "2026-01-01", open: true });
  });

  test("computed baselines persist in findings", () => {
    const db = makeDb("wrist_temp", 28);
    const rows = rebuildBaselines(db);
    expect(db.query("SELECT COUNT(*) AS count FROM findings").get()).toEqual({
      count: rows.length,
    });
    db.close();
  });
});
