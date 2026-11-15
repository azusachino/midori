import { openDb } from "../db/db";
import { computeDailyMetrics } from "../stats/daily";
import { mapRecord } from "./mapper";
import { parseExportXml } from "./parser";
import type { WriteCounters } from "./store";
import { RecordWriter, refreshSources } from "./store";
import { openExportXml } from "./zip";

/**
 * Import orchestration (T6): imports-row lifecycle, zip → parse → map →
 * transactional store, sources refresh. One import at a time per database
 * (the HTTP layer enqueues; here status transitions are persisted).
 */

export interface ImportSummary extends WriteCounters {
  importId: number;
  zipPath: string;
  entryName: string;
  totalEntries: number;
  exportVersion: string | null;
  exportDate: string | null;
  malformedDates: number;
  durationMs: number;
  status: "done" | "failed";
}

export async function runImport(dbPath: string, zipPath: string): Promise<ImportSummary> {
  const t0 = performance.now();
  const zipStat = await Bun.file(zipPath).stat();
  const db = openDb(dbPath);

  try {
    db.run(
      `INSERT INTO imports (created_at, zip_name, zip_size, status)
       VALUES (?, ?, ?, 'queued')`,
      [new Date().toISOString(), zipPath.split("/").pop() ?? zipPath, zipStat.size],
    );
    const importId = Number(
      (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
    );
    const setStatus = (status: string, error: string | null = null) =>
      db.run(`UPDATE imports SET status = ?, error = ? WHERE id = ?`, [status, error, importId]);

    setStatus("unpacking");
    const handle = await openExportXml(zipPath);

    setStatus("parsing");
    const writer = new RecordWriter(db, importId);
    let malformedDates = 0;
    const stats = await parseExportXml(handle.chunks, {
      onRecord: (row) => {
        const mapped = mapRecord(row);
        if (mapped.ok) writer.add(mapped.record);
        else malformedDates += 1;
      },
    });
    await handle.closed;

    setStatus("storing");
    const counters = writer.finish();
    refreshSources(db, importId);

    // Stats are a derived cache, recomputed on every import (design.md).
    // Runs within the storing phase (~1s on 2M records): 'analyzing' is not a
    // user-visible lifecycle state worth a schema CHECK update.
    computeDailyMetrics(db, importId);

    const durationMs = Math.round(performance.now() - t0);
    setStatus("done");
    db.run(
      `UPDATE imports SET records_seen = ?, records_inserted = ?, records_deduped = ?,
         duration_ms = ?, export_version = ? WHERE id = ?`,
      [
        stats.recordCount,
        counters.inserted,
        counters.deduped,
        durationMs,
        stats.exportVersion,
        importId,
      ],
    );

    return {
      importId,
      zipPath,
      entryName: handle.entryName,
      totalEntries: handle.totalEntries,
      exportVersion: stats.exportVersion,
      exportDate: stats.exportDate,
      malformedDates,
      durationMs,
      status: "done",
      ...counters,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.run(
      `UPDATE imports SET status = 'failed', error = ? WHERE id = (
       SELECT id FROM imports ORDER BY id DESC LIMIT 1)`,
      [message],
    );
    throw err;
  } finally {
    db.close();
  }
}
