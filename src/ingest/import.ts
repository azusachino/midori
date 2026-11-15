import { openDb } from "../db/db";
import { computeDailyMetrics } from "../stats/daily";
import { persistDeviceEvents } from "../stats/events";
import { recomputeFindings } from "../stats/findings";
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

export interface RunImportOptions {
  /**
   * Drive an existing `queued` imports row (HTTP path, which creates the row
   * before answering 202). Omit to insert a new row (CLI path).
   */
  importId?: number;
  /** Checked at each record boundary; an aborted run ends `failed` with the reason. */
  signal?: AbortSignal;
}

export async function runImport(
  dbPath: string,
  zipPath: string,
  options: RunImportOptions = {},
): Promise<ImportSummary> {
  const t0 = performance.now();
  const zipStat = await Bun.file(zipPath).stat();
  const db = openDb(dbPath);
  let importId: number | null = options.importId ?? null;

  const checkAborted = () => {
    const signal = options.signal;
    if (!signal?.aborted) return;
    const reason = signal.reason;
    throw new Error(
      `import aborted: ${reason instanceof Error ? reason.message : String(reason ?? "aborted")}`,
    );
  };

  try {
    if (importId === null) {
      db.run(
        `INSERT INTO imports (created_at, zip_name, zip_size, status)
         VALUES (?, ?, ?, 'queued')`,
        [new Date().toISOString(), zipPath.split("/").pop() ?? zipPath, zipStat.size],
      );
      importId = Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
    }
    const id: number = importId;
    const setStatus = (status: string, error: string | null = null) =>
      db.run(`UPDATE imports SET status = ?, error = ? WHERE id = ?`, [status, error, id]);

    checkAborted();
    setStatus("unpacking");
    const handle = await openExportXml(zipPath);

    checkAborted();
    setStatus("parsing");
    const writer = new RecordWriter(db, id);
    let malformedDates = 0;
    const stats = await parseExportXml(handle.chunks, {
      onRecord: (row) => {
        checkAborted();
        const mapped = mapRecord(row);
        if (mapped.ok) writer.add(mapped.record);
        else malformedDates += 1;
      },
    });
    await handle.closed;

    checkAborted();
    setStatus("storing");
    const counters = writer.finish();
    refreshSources(db, id);

    // Stats are a derived cache, recomputed on every import (design.md).
    // Runs within the storing phase (~1s on 2M records): 'analyzing' is not a
    // user-visible lifecycle state worth a schema CHECK update.
    computeDailyMetrics(db, id);
    persistDeviceEvents(db, id);
    recomputeFindings(db, id);

    const durationMs = Math.round(performance.now() - t0);
    setStatus("done");
    db.run(
      `UPDATE imports SET records_seen = ?, records_inserted = ?, records_deduped = ?,
         duration_ms = ?, export_version = ? WHERE id = ?`,
      [stats.recordCount, counters.inserted, counters.deduped, durationMs, stats.exportVersion, id],
    );

    return {
      importId: id,
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
    // A parse failure can leave RecordWriter's transaction open; close() would
    // roll the status update back with it, so discard it explicitly first.
    if (db.inTransaction) db.exec("ROLLBACK");
    const message = err instanceof Error ? err.message : String(err);
    if (importId !== null) {
      db.run(`UPDATE imports SET status = 'failed', error = ? WHERE id = ?`, [message, importId]);
    }
    throw err;
  } finally {
    db.close();
  }
}
