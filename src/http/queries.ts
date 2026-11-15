import type { Database } from "bun:sqlite";
import type { ImportDTO, SourceDTO } from "../domain/api";

export function listImports(db: Database): ImportDTO[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, zip_name, zip_size, status, error, export_version,
              records_seen, records_inserted, records_deduped, duration_ms
       FROM imports ORDER BY id DESC`,
    )
    .all() as Array<{
    id: number;
    created_at: string;
    zip_name: string;
    zip_size: number;
    status: string;
    error: string | null;
    export_version: string | null;
    records_seen: number | null;
    records_inserted: number | null;
    records_deduped: number | null;
    duration_ms: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    zipName: row.zip_name,
    zipSize: row.zip_size,
    status: row.status as ImportDTO["status"],
    error: row.error,
    exportVersion: row.export_version,
    recordsSeen: row.records_seen,
    recordsInserted: row.records_inserted,
    recordsDeduped: row.records_deduped,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }));
}

export function listSources(db: Database): SourceDTO[] {
  const rows = db
    .prepare(
      `SELECT name, first_seen_at, last_seen_at, record_count FROM sources ORDER BY record_count DESC`,
    )
    .all() as Array<{
    name: string;
    first_seen_at: string;
    last_seen_at: string;
    record_count: number;
  }>;
  return rows.map((row) => ({
    name: row.name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    recordCount: row.record_count,
  }));
}
