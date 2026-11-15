import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations } from "../src/db/db";
import { rebuildNightPipeline } from "../src/stats/nights";

const RECORDS = Number(process.env.MIDORI_BENCH_RECORDS ?? 2_000_000);
const childPath = process.argv[2] === "--derive" ? process.argv[3] : undefined;

if (childPath) {
  const db = new Database(childPath);
  const phases: Record<string, number> = {};
  const start = performance.now();
  const nights = rebuildNightPipeline(db, (phase, elapsedMs) => {
    phases[`${phase}Ms`] = elapsedMs;
  });
  const elapsedMs = performance.now() - start;
  const epochs = (db.query("SELECT COUNT(*) AS count FROM epochs").get() as { count: number })
    .count;
  const metricValues = (
    db.query("SELECT COUNT(*) AS count FROM metric_values").get() as { count: number }
  ).count;
  const metricCount = (
    db.query("SELECT COUNT(DISTINCT metric) AS count FROM metric_values").get() as { count: number }
  ).count;
  const maxRssBytes = process.resourceUsage().maxRSS * 1024;
  db.close();
  console.log(
    JSON.stringify({
      records: RECORDS,
      nights: nights.length,
      epochs,
      metricValues,
      metricCount,
      elapsedMs,
      maxRssBytes,
      ...phases,
    }),
  );
} else {
  const scratchRoot = join(process.cwd(), ".tmp");
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "midori-s4-pipeline-"));
  const path = join(scratch, "bench.db");
  try {
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    applyMigrations(db);
    db.prepare(
      `INSERT INTO imports (created_at, zip_name, zip_size, status, export_date)
       VALUES ('2028-10-23T00:00:00Z', 'synthetic-benchmark.zip', 1, 'done', '2030-01-01 12:00:00 +0000')`,
    ).run();
    const insertStatement = db.prepare(`INSERT INTO records
      (type, source_name, start_at, end_at, start_offset_min, end_offset_min, value, value_str,
       import_id, device_hw, device_sw, meta_json)
      VALUES (?, 'Synthetic Watch Source', ?, ?, 540, 540, ?, ?, 1, ?, ?, ?)`);
    const insert = (
      type: string,
      startAt: string,
      endAt: string,
      value: number | null,
      valueStr: string | null,
      hardware: string | null,
      metadata: string | null,
    ) =>
      insertStatement.run(
        type,
        startAt,
        endAt,
        value,
        valueStr,
        hardware,
        hardware === null ? null : "26.0",
        metadata,
      );
    const base = Date.UTC(2025, 0, 1);
    const seedStart = performance.now();
    db.exec("BEGIN");
    for (let i = 0; i < RECORDS; i++) {
      const at = base + i * 60_000;
      const timestamp = new Date(at).toISOString();
      const bucket = (i * 37) % 100;
      const hardware = bucket >= 45 && bucket <= 74 ? null : "Watch7,5";
      if (bucket < 45) {
        insert(
          "HKQuantityTypeIdentifierHeartRate",
          timestamp,
          timestamp,
          50 + (i % 55),
          null,
          hardware,
          null,
        );
      } else if (bucket < 70) {
        const stage =
          [
            "HKCategoryValueSleepAnalysisAsleepCore",
            "HKCategoryValueSleepAnalysisAsleepDeep",
            "HKCategoryValueSleepAnalysisAsleepREM",
            "HKCategoryValueSleepAnalysisInBed",
            "HKCategoryValueSleepAnalysisAsleepUnspecified",
          ][i % 5] ?? "HKCategoryValueSleepAnalysisAsleepCore";
        insert(
          "HKCategoryTypeIdentifierSleepAnalysis",
          timestamp,
          new Date(at + 90_000).toISOString(),
          null,
          stage,
          hardware,
          JSON.stringify({ HKTimeZone: "America/Los_Angeles" }),
        );
      } else if (bucket < 75) {
        insert(
          "HKQuantityTypeIdentifierRestingHeartRate",
          timestamp,
          timestamp,
          50 + (i % 15),
          null,
          hardware,
          null,
        );
      } else if (bucket < 78) {
        insert(
          "HKQuantityTypeIdentifierStepCount",
          timestamp,
          timestamp,
          1 + (i % 30),
          null,
          hardware,
          null,
        );
      } else if (bucket < 81) {
        insert(
          "HKQuantityTypeIdentifierRespiratoryRate",
          timestamp,
          timestamp,
          12 + (i % 8) / 2,
          null,
          hardware,
          null,
        );
      } else if (bucket < 84) {
        insert(
          "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
          timestamp,
          timestamp,
          30 + (i % 40),
          null,
          hardware,
          null,
        );
      } else if (bucket < 87) {
        insert(
          "HKQuantityTypeIdentifierHeartRateVariabilityRMSSD",
          timestamp,
          timestamp,
          25 + (i % 35),
          null,
          hardware,
          null,
        );
      } else if (bucket < 90) {
        insert(
          "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
          timestamp,
          timestamp,
          36 + (i % 10) / 10,
          null,
          hardware,
          null,
        );
      } else if (bucket < 93) {
        insert(
          "HKQuantityTypeIdentifierOxygenSaturation",
          timestamp,
          timestamp,
          94 + (i % 6),
          null,
          hardware,
          null,
        );
      } else if (bucket < 96) {
        insert(
          "HKQuantityTypeIdentifierVO2Max",
          timestamp,
          timestamp,
          35 + (i % 12),
          null,
          hardware,
          null,
        );
      } else {
        insert(
          "HKQuantityTypeIdentifierActiveEnergyBurned",
          timestamp,
          timestamp,
          100 + (i % 50),
          null,
          hardware,
          null,
        );
      }
      if (i % 20_000 === 19_999) db.exec("COMMIT; BEGIN");
    }
    db.exec("COMMIT");
    db.close();
    const seedSeconds = (performance.now() - seedStart) / 1000;
    const proc = Bun.spawnSync(["bun", "scripts/bench-derive.ts", "--derive", path], {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, MIDORI_BENCH_RECORDS: String(RECORDS) },
    });
    const output = new TextDecoder().decode(proc.stdout).trim();
    if (proc.exitCode !== 0)
      throw new Error(`pipeline benchmark exited ${proc.exitCode}: ${output}`);
    const result = JSON.parse(output) as {
      records: number;
      nights: number;
      epochs: number;
      metricValues: number;
      metricCount: number;
      elapsedMs: number;
      maxRssBytes: number;
      epochsMs: number;
      resolverMs: number;
      sleepMs: number;
      metricsMs: number;
      stintsMs: number;
      persistMs: number;
      nightsMs: number;
    };
    console.log(
      `records=${result.records.toLocaleString()} epochs=${result.epochs} nights=${result.nights.toLocaleString()} metrics=${result.metricCount} metric_values=${result.metricValues.toLocaleString()}`,
    );
    console.log(
      `mix=45% heart_rate, 25% sleep (device-less), 5% RHR (device-less), 25% other metrics; seed=${seedSeconds.toFixed(1)}s epochs=${(result.epochsMs / 1000).toFixed(1)}s resolver=${(result.resolverMs / 1000).toFixed(1)}s sleep=${(result.sleepMs / 1000).toFixed(1)}s metrics=${(result.metricsMs / 1000).toFixed(1)}s stints=${(result.stintsMs / 1000).toFixed(1)}s persist=${(result.persistMs / 1000).toFixed(1)}s total=${(result.nightsMs / 1000).toFixed(1)}s pipeline=${(result.elapsedMs / 1000).toFixed(1)}s peak_rss=${(result.maxRssBytes / (1024 * 1024)).toFixed(0)} MiB`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
