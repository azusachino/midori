import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { METRICS } from "../domain/metrics";
import { type ImportRouteOptions, mountImportRoutes } from "./import";
import {
  briefing,
  DEFAULT_DEVIATION_DAYS,
  listDeviations,
  listFindings,
  listImports,
  listSources,
  metricDaily,
} from "./queries";

/**
 * Read routes (T13) over the shared queries in ./queries — the same
 * implementation the MCP server exposes (T20). All computed payloads carry
 * as-of + trust (contract: "never strip it in a consumer").
 */

interface RouteDeps {
  db: Database;
  /** Upload/job route (T14); omitted in read-only deployments and read-only tests. */
  upload?: Omit<ImportRouteOptions, "db">;
}

export function createApp({ db, upload }: RouteDeps): Hono {
  const app = new Hono();
  if (upload) mountImportRoutes(app, { ...upload, db });

  app.get("/api/imports", (c) => c.json(listImports(db)));

  app.get("/api/sources", (c) => c.json(listSources(db)));

  app.get("/api/findings", (c) => c.json(listFindings(db)));

  app.get("/api/briefing", (c) => c.json(briefing(db)));

  app.get("/api/deviations", (c) => {
    const raw = c.req.query("days");
    let days = DEFAULT_DEVIATION_DAYS;
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return c.json({ error: "days must be an integer in [1, 365]", retryable: false }, 400);
      }
      days = n;
    }
    return c.json(listDeviations(db, days));
  });

  app.get("/api/metrics/:metric/daily", (c) => {
    const metric = c.req.param("metric");
    if (!(metric in METRICS)) {
      return c.json({ error: `unknown metric: ${metric}`, retryable: false }, 404);
    }
    return c.json(metricDaily(db, metric));
  });

  return app;
}
