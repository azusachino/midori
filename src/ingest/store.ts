import type { Database } from "bun:sqlite";
import type { MappedRecord } from "./mapper";

/**
 * Insert hot path (T6). Raw bun:sqlite prepared statements inside batched
 * transactions — the in-task benchmark (scripts/bench-insert.ts, 2026-11-14)
 * measured raw at ~509k rows/s vs drizzle ~130k rows/s over 2M rows, so the
 * write path skips the ORM; drizzle remains the typed read layer.
 */

export const INSERT_BATCH = 10_000;

export interface WriteCounters {
  attempted: number;
  inserted: number;
  deduped: number;
}

export class RecordWriter {
  private stmt: import("bun:sqlite").Statement;
  private backfillStmt: import("bun:sqlite").Statement;
  private buffered = 0;
  readonly counters: WriteCounters = { attempted: 0, inserted: 0, deduped: 0 };

  constructor(
    private readonly db: Database,
    private readonly importId: number,
    private readonly batch = INSERT_BATCH,
  ) {
    this.stmt = db.prepare(
      `INSERT OR IGNORE INTO records
         (type, source_name, unit, start_at, end_at, start_offset_min, end_offset_min,
          value, value_str, import_id, device_hw, device_sw, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.backfillStmt = db.prepare(
      `UPDATE records SET
         device_hw = COALESCE(device_hw, ?),
         device_sw = COALESCE(device_sw, ?),
         meta_json = COALESCE(meta_json, ?)
       WHERE type = ? AND source_name = ? AND start_at = ? AND end_at = ?
         AND coalesce(value, value_str, '<NULL>') = coalesce(?, ?, '<NULL>')
         AND (device_hw IS NULL OR device_sw IS NULL OR meta_json IS NULL)`,
    );
    this.db.exec("BEGIN");
  }

  add(rec: MappedRecord): void {
    const r = rec.row;
    const res = this.stmt.run(
      r.type,
      r.sourceName,
      r.unit,
      r.startAt,
      r.endAt,
      r.startOffsetMin,
      r.endOffsetMin,
      r.value,
      r.valueStr,
      this.importId,
      r.deviceHw,
      r.deviceSw,
      r.metaJson,
    );
    this.counters.attempted += 1;
    if (res.changes > 0) this.counters.inserted += 1;
    else {
      this.backfillStmt.run(
        r.deviceHw,
        r.deviceSw,
        r.metaJson,
        r.type,
        r.sourceName,
        r.startAt,
        r.endAt,
        r.value,
        r.valueStr,
      );
      this.counters.deduped += 1;
    }
    if (++this.buffered >= this.batch) {
      this.db.exec("COMMIT");
      this.db.exec("BEGIN");
      this.buffered = 0;
    }
  }

  finish(): WriteCounters {
    this.db.exec("COMMIT");
    this.buffered = 0;
    return this.counters;
  }
}

/**
 * Rebuilds the sources table from the records table after an import: one
 * grouped upsert keeping first/last-seen and authoritative record counts.
 */
export function refreshSources(db: Database, importId: number): void {
  db.run(
    `INSERT INTO sources (name, first_seen_at, last_seen_at, record_count, last_import_id)
     SELECT source_name, MIN(start_at), MAX(start_at), COUNT(*), ?1
       FROM records GROUP BY source_name
     ON CONFLICT(name) DO UPDATE SET
       first_seen_at = excluded.first_seen_at,
       last_seen_at = excluded.last_seen_at,
       record_count = excluded.record_count,
       last_import_id = excluded.last_import_id`,
    [importId],
  );
}
