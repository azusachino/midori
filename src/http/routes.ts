import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getBuildInfo } from "../domain/build";
import { getHealthContext, isValidContextDays } from "../stats/context";
import { getImportDiff } from "../stats/diff";
import {
  createNote,
  deleteNote,
  getNote,
  isCalendarDay,
  listNotes,
  noteFields,
  updateNote,
  validateNoteFields,
} from "../stats/notes";
import { getProfileContext, saveProfileContext, validateProfileFields } from "../stats/profile";
import { type ImportRouteOptions, mountImportRoutes } from "./import";
import {
  getChanges,
  getEpochs,
  getImport,
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

  app.get("/api/health", (c) => {
    db.query("SELECT 1").get();
    const { version, revision } = getBuildInfo();
    return c.json({ ok: true as const, version, revision });
  });

  // B-P1–B-P2: the owner's profile context is always readable; only mutations need upload.
  app.get("/api/profile", (c) => c.json(getProfileContext(db)));
  if (upload) {
    app.put("/api/profile", async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const validation = validateProfileFields(body);
      if (!validation.ok) return c.json({ error: validation.error, retryable: false }, 400);
      return c.json(saveProfileContext(db, validation.value));
    });
  } else {
    app.put("/api/profile", (c) =>
      c.json({ error: "profile is read-only", retryable: false }, 405),
    );
  }

  // B-A5: the same dossier MCP `health_context` returns.
  app.get("/api/context", (c) => {
    const raw = c.req.query("days");
    const days = raw === undefined || raw === "" ? undefined : Number(raw);
    if (days !== undefined && !isValidContextDays(days))
      return c.json({ error: "days must be an integer between 7 and 30", retryable: false }, 400);
    return c.json(getHealthContext(db, days));
  });
  app.get("/api/imports", (c) => c.json(listImports(db)));
  app.get("/api/imports/:id/diff", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0 || !getImport(db, id))
      return c.json({ error: "import not found", retryable: false }, 404);
    return c.json({ diff: getImportDiff(db, id) });
  });
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

  // Owner notes: reads are always available; mutations only where uploads are (B-U1–B-U4).
  app.get("/api/notes", (c) => {
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    if ((from !== "" && !isCalendarDay(from)) || (to !== "" && !isCalendarDay(to)))
      return c.json({ error: "from and to must be calendar dates", retryable: false }, 400);
    return c.json({ notes: listNotes(db, from || null, to || null) });
  });
  if (upload) {
    app.post("/api/notes", async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const validation = validateNoteFields(body);
      if (!validation.ok) return c.json({ error: validation.error, retryable: false }, 400);
      return c.json(createNote(db, validation.value), 201);
    });
    app.patch("/api/notes/:id", async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0)
        return c.json({ error: "note not found", retryable: false }, 404);
      const existing = getNote(db, id);
      if (!existing) return c.json({ error: "note not found", retryable: false }, 404);
      const body: unknown = await c.req.json().catch(() => null);
      const validation = validateNoteFields(body, noteFields(existing));
      if (!validation.ok) return c.json({ error: validation.error, retryable: false }, 400);
      return c.json(updateNote(db, id, validation.value));
    });
    app.delete("/api/notes/:id", (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || id <= 0 || !deleteNote(db, id))
        return c.json({ error: "note not found", retryable: false }, 404);
      return c.json({ deleted: true as const });
    });
  } else {
    app.post("/api/notes", (c) => c.json({ error: "notes are read-only", retryable: false }, 405));
    app.patch("/api/notes/:id", (c) =>
      c.json({ error: "notes are read-only", retryable: false }, 405),
    );
    app.delete("/api/notes/:id", (c) =>
      c.json({ error: "notes are read-only", retryable: false }, 405),
    );
  }

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
