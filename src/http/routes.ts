import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { type ImportRouteOptions, mountImportRoutes } from "./import";
import {
  getChanges,
  getEpochs,
  getMetrics,
  getNights,
  getSeries,
  getUnitEvidence,
  listImports,
} from "./queries";

interface RouteDeps {
  db: Database;
  /** Upload/job route; omitted in read-only deployments and read-only tests. */
  upload?: Omit<ImportRouteOptions, "db">;
}

export function createApp({ db, upload }: RouteDeps): Hono {
  const app = new Hono();
  if (upload) mountImportRoutes(app, { ...upload, db });

  app.get("/api/imports", (c) => c.json(listImports(db)));
  app.get("/api/changes", (c) => c.json(getChanges(db)));
  app.get("/api/metrics", (c) => c.json(getMetrics(db)));
  app.get("/api/metrics/:metric/units/:day", (c) => {
    const value = getUnitEvidence(db, c.req.param("metric"), c.req.param("day"));
    return value
      ? c.json(value)
      : c.json({ error: "metric unit not found or after as-of", retryable: false }, 404);
  });
  app.get("/api/metrics/:metric", (c) => {
    const range = c.req.query("range") ?? "180d";
    if (!["90d", "180d", "1y", "all"].includes(range))
      return c.json({ error: "range must be 90d, 180d, 1y, or all", retryable: false }, 400);
    const value = getSeries(db, c.req.param("metric"), range);
    return value ? c.json(value) : c.json({ error: "unknown metric", retryable: false }, 404);
  });
  app.get("/api/epochs", (c) => c.json(getEpochs(db)));
  app.get("/api/nights", (c) => {
    const from = c.req.query("from") ?? "",
      to = c.req.query("to") ?? "";
    const value = getNights(db, from, to);
    if (value === false)
      return c.json({ error: "nights range cannot exceed 400 days", retryable: false }, 400);
    return value
      ? c.json(value)
      : c.json({ error: "valid from and to dates are required", retryable: false }, 400);
  });

  return app;
}
