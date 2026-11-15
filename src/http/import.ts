import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Hono } from "hono";
import { archiveZip, backupDatabase, DEFAULT_BACKUP_DIR, pruneBackups } from "../backup/backup";
import type { ErrorResponse, UploadAcceptedDTO } from "../domain/api";
import { MAX_UPLOAD_BYTES } from "../domain/api";
import { type ImportSummary, type RunImportOptions, runImport } from "../ingest/import";

/**
 * Upload + job route (T14). `POST /api/imports` spools a raw zip body to
 * `spoolDir`, creates a `queued` imports row, answers 202, then runs the same
 * `runImport` pipeline the CLI uses in-process. One job per database at a time:
 * a second POST while one is running (or still spooling) gets a typed 409.
 */

/** Hard wall-clock budget for one import job; exceeding it aborts at the next record. */
export const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

/** Default spool location, relative to the working directory (gitignored `data/`). */
export const DEFAULT_SPOOL_DIR = "data/spool";

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
  /** Test seam: override the pipeline (defaults to the real `runImport`). */
  runImport?: ImportRunner;
  /** Test seam: override the wall-clock budget. */
  timeoutMs?: number;
  /** Test seam: override the upload ceiling. */
  maxBytes?: number;
}

/** In-process lock: dbPath -> true while a job holds the database (spooling or running). */
const activeJobs = new Set<string>();

/** Test-only visibility into the lock; not part of the HTTP contract. */
export function isImportLocked(dbPath: string): boolean {
  return activeJobs.has(dbPath);
}

type ErrorStatus = 400 | 409 | 413 | 415;

function jsonError(error: string, status: ErrorStatus, retryable: boolean, importId?: number) {
  const body: ErrorResponse =
    importId === undefined ? { error, retryable } : { error, retryable, importId };
  return { body, status } as const;
}

function sanitizeName(raw: string | undefined): string {
  const name = basename((raw ?? "").trim());
  return name.length > 0 && name.length <= 255 ? name : "upload.zip";
}

/** Streams the request body into `path`; returns the byte count or null when over `maxBytes`. */
async function spool(body: ReadableStream<Uint8Array>, path: string, maxBytes: number) {
  const sink = Bun.file(path).writer();
  const close = async () => {
    await sink.end();
  };
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await close();
        rmSync(path, { force: true });
        return null;
      }
      sink.write(value);
    }
    await close();
    return total;
  } catch (err) {
    await close().catch(() => undefined);
    rmSync(path, { force: true });
    throw err;
  }
}

export function mountImportRoutes(app: Hono, opts: ImportRouteOptions): void {
  const spoolDir = opts.spoolDir ?? DEFAULT_SPOOL_DIR;
  const backupDir = opts.backupDir ?? DEFAULT_BACKUP_DIR;
  const runner = opts.runImport ?? runImport;
  const timeoutMs = opts.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const { db, dbPath, archiveDir } = opts;

  /** Runs the pipeline under a deadline; the lock is released in `finally` on every path. */
  async function job(importId: number, zipPath: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`exceeded ${timeoutMs} ms time limit`)),
      timeoutMs,
    );
    try {
      await runner(dbPath, zipPath, { importId, signal: controller.signal });
      try {
        // Post-success maintenance mirrors the CLI (design: backups are owned by midori).
        backupDatabase(dbPath, { backupDir });
        pruneBackups(backupDir, { now: new Date() });
        archiveZip(zipPath, { archiveDir });
      } catch (err) {
        // The import itself succeeded; a failed backup/archive must not flip it to failed.
        console.error(`import ${importId}: post-import maintenance failed: ${String(err)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // runImport marks its own failures; this covers failures before its try block.
      db.run(
        `UPDATE imports SET status = 'failed', error = ?
         WHERE id = ? AND status NOT IN ('done', 'failed')`,
        [message, importId],
      );
      rmSync(zipPath, { force: true });
    } finally {
      clearTimeout(timer);
      activeJobs.delete(dbPath);
    }
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

    // Claim the database synchronously, before any await, so two POSTs cannot both pass.
    activeJobs.add(dbPath);
    let released = false;
    const release = () => {
      if (!released) activeJobs.delete(dbPath);
      released = true;
    };

    try {
      mkdirSync(spoolDir, { recursive: true });
      const spoolPath = join(spoolDir, `${randomUUID()}.zip`);
      const tmpPath = `${spoolPath}.part`;
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
      renameSync(tmpPath, spoolPath);

      const zipName = sanitizeName(c.req.header("x-zip-name"));
      db.run(
        `INSERT INTO imports (created_at, zip_name, zip_size, status) VALUES (?, ?, ?, 'queued')`,
        [new Date().toISOString(), zipName, bytes],
      );
      const importId = Number(
        (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
      );

      // Hand off: the job owns the lock from here and releases it in its finally.
      released = true;
      job(importId, spoolPath).catch((err) => {
        console.error(`import ${importId}: job crashed: ${String(err)}`);
      });

      const accepted: UploadAcceptedDTO = { importId, status: "queued" };
      return c.json(accepted, 202);
    } catch (err) {
      release();
      throw err;
    }
  });
}
