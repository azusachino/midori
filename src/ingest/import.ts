import { openDb } from "../db/db";
import { derive } from "../stats/derive";
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
  asOfDay: string | null;
  malformedDates: number;
  newUsableNights: number;
  newEpochs: string[];
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
  /** Test seam: simulate expensive synchronous derive work inside the import worker. */
  deriveSpinMs?: number;
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
      db.run(`UPDATE imports SET status = ?, stage = ?, error = ? WHERE id = ?`, [
        status,
        status,
        error,
        id,
      ]);

    checkAborted();
    setStatus("unpacking");
    const handle = await openExportXml(zipPath);

    checkAborted();
    setStatus("parsing");
    const writer = new RecordWriter(db, id);
    let malformedDates = 0;
    let parsedBytes = 0;
    async function* trackedChunks() {
      for await (const chunk of handle.chunks) {
        parsedBytes += chunk.byteLength;
        db.run(`UPDATE imports SET progress = ? WHERE id = ?`, [parsedBytes, id]);
        yield chunk;
      }
    }
    db.run(`UPDATE imports SET progress = 0, progress_total = ? WHERE id = ?`, [
      handle.uncompressedSize,
      id,
    ]);
    const stats = await parseExportXml(trackedChunks(), {
      onRecord: (row) => {
        checkAborted();
        const mapped = mapRecord(row);
        if (mapped.ok) writer.add(mapped.record);
        else malformedDates += 1;
      },
    });
    await handle.closed;

    const priorMax = db.query("SELECT MAX(end_at) AS latest FROM records").get() as {
      latest: string | null;
    };
    const exportTime = stats.exportDate === null ? Number.NaN : Date.parse(stats.exportDate);
    const olderThanStored =
      Number.isFinite(exportTime) && priorMax.latest !== null
        ? exportTime < Date.parse(priorMax.latest)
        : false;
    db.run(`UPDATE imports SET export_date = ?, older_than_stored = ? WHERE id = ?`, [
      stats.exportDate,
      Number(olderThanStored),
      id,
    ]);
    checkAborted();
    setStatus("storing");
    const counters = writer.finish();
    refreshSources(db, id);

    // Keep the current derived snapshot readable until this entire rebuild commits.
    const priorUsableNights = Number(
      (
        db
          .query(
            "SELECT COUNT(DISTINCT unit_day) AS count FROM metric_values WHERE metric = 'sleep_h' AND usable = 1",
          )
          .get() as { count: number }
      ).count,
    );
    const priorEpochs = new Set(
      (
        db.query("SELECT source_name, device_hw FROM epochs").all() as Array<{
          source_name: string;
          device_hw: string;
        }>
      ).map((epoch) => JSON.stringify([epoch.source_name, epoch.device_hw])),
    );
    setStatus("deriving");
    if (options.deriveSpinMs) {
      const until = performance.now() + options.deriveSpinMs;
      while (performance.now() < until) {
        checkAborted();
      }
    }
    derive(db);
    const nextUsableNights = Number(
      (
        db
          .query(
            "SELECT COUNT(DISTINCT unit_day) AS count FROM metric_values WHERE metric = 'sleep_h' AND usable = 1",
          )
          .get() as { count: number }
      ).count,
    );
    const nextEpochs = db.query("SELECT source_name, device_hw, kind FROM epochs").all() as Array<{
      source_name: string;
      device_hw: string;
      kind: string;
    }>;
    const newUsableNights = Math.max(0, nextUsableNights - priorUsableNights);
    const newEpochs = nextEpochs
      .filter((epoch) => !priorEpochs.has(JSON.stringify([epoch.source_name, epoch.device_hw])))
      .map((epoch) => {
        const device =
          epoch.device_hw || `${epoch.kind.slice(0, 1).toUpperCase()}${epoch.kind.slice(1)}`;
        return `${epoch.source_name} (${device})`;
      })
      .sort((a, b) => a.localeCompare(b));

    const asOfDay = (
      db
        .query("SELECT MAX(unit_day) day FROM metric_values WHERE metric='sleep_h' AND usable=1")
        .get() as { day: string | null }
    ).day;
    const durationMs = Math.round(performance.now() - t0);
    setStatus("done");
    db.run(
      `UPDATE imports SET progress = ?, progress_total = ?, records_seen = ?, records_inserted = ?, records_deduped = ?,
         new_usable_nights = ?, new_epochs = ?, duration_ms = ?, export_version = ?, export_date = ? WHERE id = ?`,
      [
        parsedBytes,
        handle.uncompressedSize,
        stats.recordCount,
        counters.inserted,
        counters.deduped,
        newUsableNights,
        JSON.stringify(newEpochs),
        durationMs,
        stats.exportVersion,
        stats.exportDate,
        id,
      ],
    );

    return {
      importId: id,
      zipPath,
      entryName: handle.entryName,
      totalEntries: handle.totalEntries,
      exportVersion: stats.exportVersion,
      exportDate: stats.exportDate,
      asOfDay,
      malformedDates,
      newUsableNights,
      newEpochs,
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
