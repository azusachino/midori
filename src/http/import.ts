import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Hono } from "hono";
import { archiveZip, backupDatabase, DEFAULT_BACKUP_DIR, pruneBackups } from "../backup/backup";
import type { ErrorResponse, ImportDTO, UploadAcceptedDTO } from "../domain/api";
import { MAX_UPLOAD_BYTES } from "../domain/api";
import { type ImportSummary, type RunImportOptions, runImport } from "../ingest/import";
import { checkHealthExportZip } from "../ingest/zip";

/**
 * Upload + job routes. The archive is validated from its central directory
 * before a row is created, then kept in the spool for retries for 24 hours.
 */

export const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_SPOOL_DIR = "data/spool";
export const SPOOL_RETENTION_MS = 24 * 60 * 60 * 1000;

export type ImportRunner = (
  dbPath: string,
  zipPath: string,
  options: RunImportOptions,
) => Promise<ImportSummary>;

export interface ImportRouteOptions {
  db: Database;
  dbPath: string;
  archiveDir: string;
  spoolDir?: string;
  backupDir?: string;
  runImport?: ImportRunner;
  timeoutMs?: number;
  maxBytes?: number;
}

const activeJobs = new Set<string>();

export function isImportLocked(dbPath: string): boolean {
  return activeJobs.has(dbPath);
}

type ErrorStatus = 400 | 409 | 410 | 413 | 415;

function jsonError(error: string, status: ErrorStatus, retryable: boolean, importId?: number) {
  const body: ErrorResponse =
    importId === undefined ? { error, retryable } : { error, retryable, importId };
  return { body, status } as const;
}

function sanitizeName(raw: string | undefined): string {
  const name = basename((raw ?? "").trim());
  return name.length > 0 && name.length <= 255 ? name : "upload.zip";
}

async function spool(body: ReadableStream<Uint8Array>, path: string, maxBytes: number) {
  const sink = Bun.file(path).writer();
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await sink.end();
        rmSync(path, { force: true });
        return null;
      }
      sink.write(value);
    }
    await sink.end();
    return total;
  } catch (err) {
    try {
      await sink.end();
    } catch {
      // Preserve the original stream error.
    }
    rmSync(path, { force: true });
    throw err;
  }
}

function spoolIsFresh(path: string, now = Date.now()): boolean {
  try {
    const age = now - statSync(path).mtimeMs;
    return age >= 0 && age <= SPOOL_RETENTION_MS;
  } catch {
    return false;
  }
}

export function mountImportRoutes(app: Hono, opts: ImportRouteOptions): void {
  const spoolDir = opts.spoolDir ?? DEFAULT_SPOOL_DIR;
  const backupDir = opts.backupDir ?? DEFAULT_BACKUP_DIR;
  const runner = opts.runImport ?? runImport;
  const timeoutMs = opts.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const { db, dbPath, archiveDir } = opts;

  function getImport(id: number): ImportDTO | undefined {
    const row = db
      .query(
        `SELECT id, created_at, zip_name, zip_size, status, stage, progress, error,
                export_version, export_date, older_than_stored, records_seen, records_inserted,
                records_deduped, duration_ms
         FROM imports WHERE id = ?`,
      )
      .get(id) as {
      id: number;
      created_at: string;
      zip_name: string;
      zip_size: number;
      status: string;
      stage: string | null;
      progress: number | null;
      error: string | null;
      export_version: string | null;
      export_date: string | null;
      older_than_stored: number | null;
      records_seen: number | null;
      records_inserted: number | null;
      records_deduped: number | null;
      duration_ms: number | null;
    } | null;
    if (!row) return undefined;
    const path = join(spoolDir, `${id}.zip`);
    return {
      id: row.id,
      zipName: row.zip_name,
      zipSize: row.zip_size,
      status: row.status as ImportDTO["status"],
      stage: row.stage,
      progress: row.progress,
      error: row.error,
      exportVersion: row.export_version,
      exportDate: row.export_date,
      olderThanStored: row.older_than_stored === 1,
      recordsSeen: row.records_seen,
      recordsInserted: row.records_inserted,
      recordsDeduped: row.records_deduped,
      retryable: row.status === "failed" && spoolIsFresh(path),
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    };
  }

  async function job(importId: number, zipPath: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`exceeded ${timeoutMs} ms time limit`)),
      timeoutMs,
    );
    try {
      await runner(dbPath, zipPath, { importId, signal: controller.signal });
      try {
        backupDatabase(dbPath, { backupDir });
        pruneBackups(backupDir, { now: new Date() });
        archiveZip(zipPath, { archiveDir });
      } catch (err) {
        console.error(`import ${importId}: post-import maintenance failed: ${String(err)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.run(
        `UPDATE imports SET status = 'failed', stage = 'failed', error = ?
         WHERE id = ? AND status NOT IN ('done', 'failed')`,
        [message, importId],
      );
      // Retain a failed job's spool for the documented 24-hour retry window.
    } finally {
      clearTimeout(timer);
      activeJobs.delete(dbPath);
    }
  }

  function start(importId: number, zipPath: string): void {
    activeJobs.add(dbPath);
    job(importId, zipPath).catch((err) => {
      console.error(`import ${importId}: job crashed: ${String(err)}`);
      activeJobs.delete(dbPath);
    });
  }

  app.post("/api/imports", async (c) => {
    if (activeJobs.has(dbPath)) {
      const { body, status } = jsonError("an import is already running", 409, true);
      return c.json(body, status);
    }
    const contentType = c.req.header("content-type") ?? "";
    if (!/^(application\/zip|application\/octet-stream)\b/i.test(contentType)) {
      const { body, status } = jsonError(
        "content-type must be application/zip (send the export.zip as the raw body)",
        415,
        false,
      );
      return c.json(body, status);
    }
    const declared = Number(c.req.header("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > maxBytes) {
      const { body, status } = jsonError(`upload exceeds ${maxBytes} bytes`, 413, false);
      return c.json(body, status);
    }
    if (!c.req.raw.body) {
      const { body, status } = jsonError("empty upload", 400, false);
      return c.json(body, status);
    }

    activeJobs.add(dbPath);
    const release = () => activeJobs.delete(dbPath);
    const tmpPath = join(spoolDir, `${randomUUID()}.part`);
    try {
      mkdirSync(spoolDir, { recursive: true });
      const bytes = await spool(c.req.raw.body, tmpPath, maxBytes);
      if (bytes === null) {
        release();
        const { body, status } = jsonError(`upload exceeds ${maxBytes} bytes`, 413, false);
        return c.json(body, status);
      }
      if (bytes === 0) {
        rmSync(tmpPath, { force: true });
        release();
        const { body, status } = jsonError("empty upload", 400, false);
        return c.json(body, status);
      }
      if (!(await checkHealthExportZip(tmpPath))) {
        rmSync(tmpPath, { force: true });
        release();
        const { body, status } = jsonError(
          "This isn't a Health export (export.xml not found).",
          400,
          false,
        );
        return c.json(body, status);
      }

      const zipName = sanitizeName(c.req.header("x-zip-name"));
      db.run(
        `INSERT INTO imports (created_at, zip_name, zip_size, status, stage, progress)
         VALUES (?, ?, ?, 'queued', 'queued', 0)`,
        [new Date().toISOString(), zipName, bytes],
      );
      const importId = Number(
        (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
      );
      const zipPath = join(spoolDir, `${importId}.zip`);
      renameSync(tmpPath, zipPath);
      start(importId, zipPath);
      const accepted: UploadAcceptedDTO = { importId, status: "queued" };
      return c.json(accepted, 202);
    } catch (err) {
      rmSync(tmpPath, { force: true });
      release();
      throw err;
    }
  });

  app.get("/api/imports/:id", (c) => {
    const id = Number(c.req.param("id"));
    const item = Number.isSafeInteger(id) && id > 0 ? getImport(id) : undefined;
    if (!item) return c.json({ error: "import not found", retryable: false }, 404);
    return c.json(item);
  });

  app.post("/api/imports/:id/retry", (c) => {
    const id = Number(c.req.param("id"));
    const item = Number.isSafeInteger(id) && id > 0 ? getImport(id) : undefined;
    if (!item) return c.json({ error: "import not found", retryable: false }, 404);
    if (activeJobs.has(dbPath)) {
      const { body, status } = jsonError("an import is already running", 409, true, id);
      return c.json(body, status);
    }
    if (!spoolIsFresh(join(spoolDir, `${id}.zip`))) {
      const { body, status } = jsonError("the retry spool has expired", 410, false, id);
      return c.json(body, status);
    }
    if (item.status !== "failed") {
      const { body, status } = jsonError("only failed imports can be retried", 409, false, id);
      return c.json(body, status);
    }
    db.run(
      `UPDATE imports SET status = 'queued', stage = 'queued', progress = 0, error = NULL
       WHERE id = ?`,
      [id],
    );
    start(id, join(spoolDir, `${id}.zip`));
    return c.json({ importId: id, status: "queued" } satisfies UploadAcceptedDTO, 202);
  });
}
