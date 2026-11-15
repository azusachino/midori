import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "./db/db";

describe("changes CLI", () => {
  test("B-I6 changes --json prints ranked finding rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "midori-cli-"));
    const dbPath = join(directory, "fixture.db");
    const db = new Database(dbPath);
    applyMigrations(db);
    db.prepare(
      `INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
       VALUES ('watch', 'Watch1,1', 'watch', '2026-01-01', '2026-01-20', 20)`,
    ).run();
    db.prepare(
      `INSERT INTO stints (metric, epoch_id, start_day, end_day)
       VALUES ('sleep_h', 1, '2026-01-01', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
       VALUES ('sleep_h', 1, '2026-01-20', 'night', 7, 1, 1),
              ('sleep_h', 1, '2026-01-21', 'night', 30, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO findings (metric, state, z, severity, confidence, checks_json, asof_day, stint_id)
       VALUES ('sleep_h', 'computed', 2.5, 'alert', 'medium', '[{"key":"low_trust","flagged":false}]', '2026-01-20', 1)`,
    ).run();
    db.close();
    try {
      const proc = Bun.spawnSync(["bun", "src/cli.ts", "changes", "--json", "--db", dbPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      const rows = JSON.parse(new TextDecoder().decode(proc.stdout)) as Array<{
        metric: string;
        severity: string;
        checks: Array<{ key: string; flagged: boolean }>;
        sparkline: Array<{ day: string; value: number | null }>;
      }>;
      expect(rows[0]?.metric).toBe("sleep_h");
      expect(rows[0]?.severity).toBe("alert");
      expect(rows[0]?.checks[0]).toEqual({ key: "device_change", flagged: false });
      expect(rows[0]?.sparkline.map((point) => point.day)).toEqual(["2026-01-20"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
