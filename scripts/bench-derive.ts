import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations } from "../src/db/db";
import { rebuildNights } from "../src/stats/nights";

const RECORDS = Number(process.env.MIDORI_BENCH_RECORDS ?? 2_000_000);
const childPath = process.argv[2] === "--derive" ? process.argv[3] : undefined;

if (childPath) {
  const db = new Database(childPath);
  const start = performance.now();
  const nights = rebuildNights(db);
  const elapsedMs = performance.now() - start;
  const maxRssBytes = process.resourceUsage().maxRSS * 1024;
  db.close();
  console.log(JSON.stringify({ records: RECORDS, nights: nights.length, elapsedMs, maxRssBytes }));
} else {
  const scratchRoot = join(process.cwd(), ".tmp");
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "midori-s4-derive-"));
  const path = join(scratch, "bench.db");
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status, export_date)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic-benchmark.zip', 1, 'done', '2026-11-15 20:00:00 +0900')`,
  ).run();
  const watchId = db
    .prepare(`INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
      VALUES ('Synthetic Watch', 'Watch7,5', 'watch', '2025-01-01', '2026-11-15', 684)`)
    .run().lastInsertRowid;
  const phoneId = db
    .prepare(`INSERT INTO epochs (source_name, device_hw, kind, first_day, last_day, days_present)
      VALUES ('Synthetic Phone', 'iPhone17,1', 'phone', '2025-01-01', '2026-11-15', 684)`)
    .run().lastInsertRowid;
  void watchId;
  void phoneId;

  const insert = db.prepare(`INSERT INTO records
    (type, source_name, start_at, end_at, start_offset_min, end_offset_min, value, value_str,
     import_id, device_hw, meta_json)
    VALUES (?, ?, ?, ?, 540, 540, ?, ?, 1, ?, ?)`);
  const base = Date.UTC(2025, 0, 1);
  const start = performance.now();
  db.exec("BEGIN");
  for (let i = 0; i < RECORDS; i++) {
    const source = i % 2 === 0 ? "Synthetic Watch" : "Synthetic Phone";
    const hardware = i % 2 === 0 ? "Watch7,5" : "iPhone17,1";
    const at = base + i * 15_000;
    const timestamp = new Date(at).toISOString();
    const bucket = i % 20;
    if (bucket < 14) {
      insert.run(
        "HKQuantityTypeIdentifierHeartRate",
        source,
        timestamp,
        timestamp,
        48 + (i % 55),
        null,
        hardware,
        null,
      );
    } else if (bucket < 16) {
      insert.run(
        "HKQuantityTypeIdentifierStepCount",
        source,
        timestamp,
        timestamp,
        1 + (i % 30),
        null,
        hardware,
        null,
      );
    } else if (bucket === 16) {
      insert.run(
        "HKQuantityTypeIdentifierRespiratoryRate",
        source,
        timestamp,
        timestamp,
        12 + (i % 8) / 2,
        null,
        hardware,
        null,
      );
    } else if (bucket === 17) {
      insert.run(
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
        source,
        timestamp,
        timestamp,
        30 + (i % 40),
        null,
        hardware,
        null,
      );
    } else if (bucket === 18) {
      const stage =
        [
          "HKCategoryValueSleepAnalysisAsleepCore",
          "HKCategoryValueSleepAnalysisAsleepDeep",
          "HKCategoryValueSleepAnalysisAsleepREM",
          "HKCategoryValueSleepAnalysisInBed",
          "HKCategoryValueSleepAnalysisAwake",
        ][i % 5] ?? "HKCategoryValueSleepAnalysisAsleepUnspecified";
      insert.run(
        "HKCategoryTypeIdentifierSleepAnalysis",
        source,
        timestamp,
        new Date(at + 5 * 60_000).toISOString(),
        null,
        stage,
        hardware,
        JSON.stringify({ HKTimeZone: "America/Los_Angeles" }),
      );
    } else {
      insert.run(
        "HKQuantityTypeIdentifierFixtureOther",
        source,
        timestamp,
        timestamp,
        1,
        null,
        hardware,
        null,
      );
    }
    if (i % 20_000 === 19_999) {
      db.exec("COMMIT; BEGIN");
    }
  }
  db.exec("COMMIT");
  db.close();
  const seedSeconds = (performance.now() - start) / 1000;
  const proc = Bun.spawnSync(["bun", "scripts/bench-derive.ts", "--derive", path], {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, MIDORI_BENCH_RECORDS: String(RECORDS) },
  });
  const output = new TextDecoder().decode(proc.stdout).trim();
  if (proc.exitCode !== 0) throw new Error(`derive benchmark exited ${proc.exitCode}: ${output}`);
  const result = JSON.parse(output) as {
    records: number;
    nights: number;
    elapsedMs: number;
    maxRssBytes: number;
  };
  console.log(
    `records=${result.records.toLocaleString()} nights=${result.nights.toLocaleString()}`,
  );
  console.log(
    `seed=${seedSeconds.toFixed(1)}s derive=${(result.elapsedMs / 1000).toFixed(1)}s peak_rss=${(result.maxRssBytes / (1024 * 1024)).toFixed(0)} MiB`,
  );
  rmSync(scratch, { recursive: true, force: true });
}
