import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { records } from "../src/db/schema";

/**
 * T6 in-task benchmark: drizzle-orm batched insert vs raw bun:sqlite prepared
 * statement over synthetic rows at real-export scale (~2M). Measures only the
 * insert hot path; parsing is streamed separately. Run: bun scripts/bench-insert.ts
 */

const N = 2_000_000;
const BATCH = 10_000;

interface Row {
  type: string;
  sourceName: string;
  unit: string | null;
  startAt: string;
  endAt: string;
  startOffsetMin: number;
  endOffsetMin: number;
  value: number | null;
  valueStr: string | null;
  importId: number;
}

function* synthRows(): Generator<Row> {
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < N; i++) {
    const ms = base + (i % 86_400_000);
    yield {
      type: "HKQuantityTypeIdentifierHeartRate",
      sourceName: i % 2 === 0 ? "WatchA" : "WatchB",
      unit: "count/min",
      startAt: new Date(ms).toISOString(),
      endAt: new Date(ms + 5000).toISOString(),
      startOffsetMin: 540,
      endOffsetMin: 540,
      value: 60 + (i % 40),
      valueStr: null,
      importId: 1,
    };
  }
}

function freshDb(label: string): Database {
  const path = `/tmp/midori-bench-${label}.db`;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {}
  }
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`CREATE TABLE records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, source_name TEXT NOT NULL, unit TEXT,
    start_at TEXT NOT NULL, end_at TEXT NOT NULL,
    start_offset_min INTEGER, end_offset_min INTEGER,
    value REAL, value_str TEXT, import_id INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX uq_records_dedup ON records
    (type, source_name, start_at, end_at, coalesce(value, value_str, '<NULL>'))`);
  return db;
}

async function benchDrizzle(): Promise<number> {
  const db = freshDb("drizzle");
  const orm = drizzle(db);
  const t0 = performance.now();
  let buf: Row[] = [];

  for (const row of synthRows()) {
    buf.push(row);
    if (buf.length >= BATCH) {
      await orm.insert(records).values(buf).onConflictDoNothing();

      buf = [];
    }
  }
  if (buf.length > 0) await orm.insert(records).values(buf).onConflictDoNothing();
  const dt = performance.now() - t0;
  db.close();
  return dt;
}

function benchRaw(): number {
  const db = freshDb("raw");
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO records (type, source_name, unit, start_at, end_at,
       start_offset_min, end_offset_min, value, value_str, import_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const t0 = performance.now();
  let inTx = 0;
  db.exec("BEGIN");
  for (const row of synthRows()) {
    stmt.run(
      row.type,
      row.sourceName,
      row.unit,
      row.startAt,
      row.endAt,
      row.startOffsetMin,
      row.endOffsetMin,
      row.value,
      row.valueStr,
      row.importId,
    );
    if (++inTx >= BATCH) {
      db.exec("COMMIT");
      db.exec("BEGIN");
      inTx = 0;
    }
  }
  db.exec("COMMIT");
  const dt = performance.now() - t0;
  db.close();
  return dt;
}

const d1 = await benchDrizzle();
const r1 = benchRaw();
// second pass (dedup path) on raw, to measure re-import cost
const d2 = await benchDrizzle();
const r2 = benchRaw();

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s (${Math.round((N / ms) * 1000).toLocaleString()} rows/s)`;
}
console.log(`rows=${N.toLocaleString()} batch=${BATCH}`);
console.log(`drizzle  pass1: ${fmt(d1)}  pass2 (all-dup): ${fmt(d2)}`);
console.log(`raw      pass1: ${fmt(r1)}  pass2 (all-dup): ${fmt(r2)}`);
