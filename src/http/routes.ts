import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { type ImportRouteOptions, mountImportRoutes } from "./import";
import { listImports } from "./queries";

interface RouteDeps {
  db: Database;
  /** Upload/job route; omitted in read-only deployments and read-only tests. */
  upload?: Omit<ImportRouteOptions, "db">;
}

const DERIVED_API_UNAVAILABLE = {
  error: "v0 read API was removed with the v1 derived schema; v1 routes arrive in slice 9",
  retryable: false,
};

export function createApp({ db, upload }: RouteDeps): Hono {
  const app = new Hono();
  if (upload) mountImportRoutes(app, { ...upload, db });

  app.get("/api/imports", (c) => c.json(listImports(db)));

  // The v0 queries depended on tables removed by migration 0003. Slice 9 replaces these routes.
  for (const path of [
    "/api/sources",
    "/api/findings",
    "/api/briefing",
    "/api/deviations",
    "/api/metrics/:metric/daily",
  ]) {
    app.get(path, (c) => c.json(DERIVED_API_UNAVAILABLE, 501));
  }

  return app;
}
