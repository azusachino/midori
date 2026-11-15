import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Hono } from "hono";
import { DEFAULT_ARCHIVE_DIR, DEFAULT_BACKUP_DIR } from "./backup/backup";
import { openDb } from "./db/db";
import { MAX_UPLOAD_BYTES } from "./domain/api";
import { DEFAULT_SPOOL_DIR, type ImportRunner } from "./http/import";
import { createApp } from "./http/routes";
import { MCP_HTTP_PATH, mountMcp } from "./mcp/http";

/**
 * HTTP entry (T15). One Bun.serve handler: `/api/*` goes to the Hono app, everything
 * else serves the built web shell from `web/dist` (SPA fallback to index.html).
 * `bun run dev` runs this with the Vite dev server; `bun run start` runs it alone.
 */

export const DEFAULT_PORT = 5174;
export const DEFAULT_WEB_DIST = "web/dist";

export interface ServerOptions {
  db: Database;
  /** Database path; the import job needs it (it opens its own connection by path). */
  dbPath: string;
  port?: number;
  hostname?: string;
  webDist?: string;
  spoolDir?: string;
  archiveDir?: string;
  backupDir?: string;
  /** Import runner and derive-stage latch used by integration tests. */
  importRunner?: ImportRunner;
  onDeriveStage?: () => Promise<void>;
}

/** Returns the built file for `pathname` under `webRoot`, or null when absent or unsafe. */
function staticFile(webRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(webRoot, `.${decoded}`);
  if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    // Stateless MCP-over-HTTP rides the same Hono app (T21).
    pathname === MCP_HTTP_PATH
  );
}

/** Builds the fetch handler: /api wins; the web shell serves everything else. */
export function createFetchHandler(app: Hono, webDist: string) {
  const webRoot = resolve(webDist);
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (isApiPath(pathname)) return app.fetch(req);

    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const asset = staticFile(webRoot, pathname);
    if (asset) return new Response(Bun.file(asset));

    // Unknown paths with a file extension are missing assets, not client routes.
    const index = staticFile(webRoot, "/index.html");
    if (!index || extname(pathname) !== "") {
      return new Response(
        index ? "not found" : "web shell not built; run `bun run build` or `bun run dev`",
        { status: 404 },
      );
    }
    return new Response(Bun.file(index), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

export function startServer(opts: ServerOptions): Bun.Server<undefined> {
  const spoolDir = opts.spoolDir ?? DEFAULT_SPOOL_DIR;
  const reconcileDb = openDb(opts.dbPath);
  try {
    reconcileDb.run(
      `UPDATE imports SET status = 'failed', error = 'interrupted by restart'
       WHERE status NOT IN ('done', 'failed')`,
    );
  } finally {
    reconcileDb.close();
  }
  const app = createApp({
    db: opts.db,
    upload: {
      dbPath: opts.dbPath,
      archiveDir: opts.archiveDir ?? DEFAULT_ARCHIVE_DIR,
      spoolDir,
      backupDir: opts.backupDir ?? DEFAULT_BACKUP_DIR,
      ...(opts.importRunner ? { runImport: opts.importRunner } : {}),
      ...(opts.onDeriveStage ? { onDeriveStage: opts.onDeriveStage } : {}),
    },
  });
  mountMcp(app, { db: opts.db });
  return Bun.serve({
    port: opts.port ?? DEFAULT_PORT,
    hostname: opts.hostname ?? "127.0.0.1",
    // Bun's default body cap is far below the 512 MB upload contract (api.ts).
    maxRequestBodySize: MAX_UPLOAD_BYTES,
    fetch: createFetchHandler(app, opts.webDist ?? DEFAULT_WEB_DIST),
  });
}

/** Reads an optional server option from MIDORI_* env, omitting it when unset. */
function envOpt<K extends keyof ServerOptions>(
  env: string,
  key: K,
): Partial<Pick<ServerOptions, K>> {
  const value = process.env[env];
  return value === undefined ? {} : ({ [key]: value } as Partial<Pick<ServerOptions, K>>);
}

if (import.meta.main) {
  const dbPath = process.env.MIDORI_DB ?? "data/midori.db";
  const rawPort = process.env.MIDORI_PORT;
  // Kubernetes service links inject MIDORI_PORT="tcp://..." if service is named "midori".
  // Only accept purely numeric port strings.
  const port = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : DEFAULT_PORT;
  const hostname = process.env.MIDORI_HOST ?? "127.0.0.1";
  // exactOptionalPropertyTypes: spread so absent envs omit the keys entirely.
  const server = startServer({
    db: openDb(dbPath),
    dbPath,
    port,
    hostname,
    ...envOpt("MIDORI_BACKUP_DIR", "backupDir"),
    ...envOpt("MIDORI_ARCHIVE_DIR", "archiveDir"),
    ...envOpt("MIDORI_SPOOL_DIR", "spoolDir"),
  });
  console.log(`midori listening on http://${hostname}:${server.port}`);
  // Bun does not exit on SIGTERM by default; as PID 1 in the container it must,
  // or every rollout waits out the grace period and dies to SIGKILL.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      server.stop(true);
      process.exit(0);
    });
  }
}
