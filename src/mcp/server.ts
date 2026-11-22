import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENT_GUIDANCE, type NoteCategory } from "../domain/api";
import { METRICS } from "../domain/metrics";
import { getChanges, getEpochs, getNights, getSeries, listImports } from "../http/queries";
import {
  BRIEFING_LIMIT_DEFAULT,
  BRIEFING_LIMIT_MAX,
  createBriefing,
  isValidBriefingLimit,
  listBriefings,
  validateBriefingFields,
} from "../stats/briefings";
import {
  CONTEXT_DEFAULT_DAYS,
  CONTEXT_MAX_DAYS,
  CONTEXT_MIN_DAYS,
  caveatsFor,
  getHealthContext,
  isValidContextDays,
} from "../stats/context";
import {
  createNote,
  getNote,
  isCalendarDay,
  listNotes,
  NOTE_CATEGORIES,
  noteFields,
  updateNote,
  validateAuthorName,
  validateNoteFields,
} from "../stats/notes";
import { getProfileContext, saveProfileContext, validateProfileFields } from "../stats/profile";

const KNOWN_METRICS = Object.keys(METRICS);

const NOTE_CATEGORY_SCHEMA = z.enum(
  NOTE_CATEGORIES as unknown as [NoteCategory, ...NoteCategory[]],
);

/**
 * MCP tools over the same query functions used by REST. The eight read tools are always
 * mounted; the four auditable write tools are mounted only when `writable` is true, and
 * they never touch `records` or any derived table (B-A7).
 */
export function createMcpServer({
  db,
  writable = false,
}: {
  db: Database;
  writable?: boolean;
}): McpServer {
  const server = new McpServer(
    { name: "midori", version: "0.1.0" },
    {
      instructions:
        "Access to an Apple Health warehouse. Never a substitute for medical advice. " +
        "Raw records and derived tables are strictly immutable. " +
        "Start with health_context for a holistic dossier (findings, long-term baselines, aligned " +
        "nights, profile, latest briefing); use changes for quick ranked findings. " +
        (writable
          ? "This server is writable: add_note, update_note, save_briefing and update_profile " +
            "append auditable owner context (never health data) tagged with the agent name. "
          : "This server is read-only; write tools are not mounted. ") +
        AGENT_GUIDANCE,
    },
  );

  server.registerTool(
    "changes",
    {
      description: `Ranked findings from the Changes view, with as-of, epoch, checks, confidence, state, onset, trust, and caveats. ${AGENT_GUIDANCE}`,
      inputSchema: {},
    },
    async () => {
      const changes = getChanges(db);
      const rows = [...changes.overnight, ...changes.daytime].map((row) => ({
        ...row,
        asOf: changes.asOfDay,
        epoch:
          row.epochId === null
            ? null
            : { id: row.epochId, label: row.epochLabel, hardware: row.epochLabel },
        caveats: caveatsFor(row),
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              asOf: changes.asOfDay,
              rows,
              sinceLastImport: changes.sinceLastImport,
              recentNotes: changes.recentNotes,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "health_context",
    {
      description: `One-call dossier: current findings with primary-stint long-term medians (90d and 1y), aligned recent nights (sleep stages, usable overnight vitals, timezone, partial data, overlapping notes), owner profile context, and what changed since the previous import. days defaults to ${CONTEXT_DEFAULT_DAYS} and must be an integer ${CONTEXT_MIN_DAYS}..${CONTEXT_MAX_DAYS}. ${AGENT_GUIDANCE}`,
      inputSchema: {
        days: z
          .number()
          .optional()
          .describe(
            `Number of recent nights to align, ${CONTEXT_MIN_DAYS}..${CONTEXT_MAX_DAYS} (default ${CONTEXT_DEFAULT_DAYS})`,
          ),
      },
    },
    async ({ days }) => {
      if (days !== undefined && !isValidContextDays(days)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `days must be an integer between ${CONTEXT_MIN_DAYS} and ${CONTEXT_MAX_DAYS}`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(getHealthContext(db, days)) }] };
    },
  );

  server.registerTool(
    "metric_series",
    {
      description: `Per-unit metric series with epoch, usability, checks, and trend context; range=all returns weekly medians. Known metrics: ${KNOWN_METRICS.join(", ")}. ${AGENT_GUIDANCE}`,
      inputSchema: {
        metric: z.string().describe("metric key, e.g. wrist_temp, sleep_h, rhr"),
        range: z.enum(["90d", "180d", "1y", "all"]).default("180d"),
      },
    },
    async ({ metric, range }) => {
      const series = getSeries(db, metric, range);
      if (!series) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `unknown metric: ${metric}`, known: KNOWN_METRICS }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(series) }] };
    },
  );

  server.registerTool(
    "nights",
    {
      description: `Night-level sleep, timezone, and completeness data for an inclusive date range. Ranges over 400 days are rejected. ${AGENT_GUIDANCE}`,
      inputSchema: {
        from: z.string().describe("First date, YYYY-MM-DD"),
        to: z.string().describe("Last date, YYYY-MM-DD"),
      },
    },
    async ({ from, to }) => {
      const nights = getNights(db, from, to);
      if (nights === false) {
        return {
          isError: true,
          content: [
            { type: "text", text: "nights range cannot exceed 400 days; narrow the date range" },
          ],
        };
      }
      if (!nights) {
        return {
          isError: true,
          content: [{ type: "text", text: "valid from and to dates are required (YYYY-MM-DD)" }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(nights) }] };
    },
  );

  server.registerTool(
    "epochs",
    {
      description: `Device epochs, primary metric roles, seams, and operating system updates. ${AGENT_GUIDANCE}`,
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getEpochs(db)) }] }),
  );

  server.registerTool(
    "list_notes",
    {
      description: `Owner-authored notes (illness, travel, alcohol, medication, stress, other) for an optional inclusive date range. Notes are confounders, never causes. ${AGENT_GUIDANCE}`,
      inputSchema: {
        from: z.string().optional().describe("First date, YYYY-MM-DD"),
        to: z.string().optional().describe("Last date, YYYY-MM-DD"),
      },
    },
    async ({ from, to }) => {
      if (
        (from !== undefined && !isCalendarDay(from)) ||
        (to !== undefined && !isCalendarDay(to))
      ) {
        return {
          isError: true,
          content: [{ type: "text", text: "valid from and to dates are required (YYYY-MM-DD)" }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ notes: listNotes(db, from, to) }) }],
      };
    },
  );

  server.registerTool(
    "list_briefings",
    {
      description: `Published agent briefings, newest first, with cited nights, cited metrics, and author. limit defaults to ${BRIEFING_LIMIT_DEFAULT} and must be an integer 1..${BRIEFING_LIMIT_MAX}. ${AGENT_GUIDANCE}`,
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe(
            `Number of briefings to return, 1..${BRIEFING_LIMIT_MAX} (default ${BRIEFING_LIMIT_DEFAULT})`,
          ),
      },
    },
    async ({ limit }) => {
      if (limit !== undefined && !isValidBriefingLimit(limit)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `limit must be an integer between 1 and ${BRIEFING_LIMIT_MAX}`,
            },
          ],
        };
      }
      const briefings = listBriefings(db, limit ?? BRIEFING_LIMIT_DEFAULT);
      return { content: [{ type: "text", text: JSON.stringify({ briefings }) }] };
    },
  );

  server.registerTool(
    "list_imports",
    {
      description: `Import history, newest first, including status and record counts. ${AGENT_GUIDANCE}`,
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(listImports(db)) }] }),
  );

  if (!writable) return server;

  /** B-A7: rejects with `{ isError: true }` and a neutral message. */
  const fail = (error: string) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: error }],
  });

  server.registerTool(
    "add_note",
    {
      description: `Append an owner-facing note as confounder context, tagged author "agent" with an auditable authorName. Writes notes only — never health records. ${AGENT_GUIDANCE}`,
      inputSchema: {
        startDay: z.string().describe("First date, YYYY-MM-DD"),
        endDay: z.string().optional().describe("Last date, YYYY-MM-DD (defaults to startDay)"),
        category: NOTE_CATEGORY_SCHEMA.describe(`One of: ${NOTE_CATEGORIES.join(", ")}`),
        label: z.string().describe("Short neutral label, 1–140 characters"),
        authorName: z.string().optional().describe("Agent name, 1–64 characters (default agent)"),
      },
    },
    async ({ startDay, endDay, category, label, authorName }) => {
      const validation = validateNoteFields({ startDay, endDay, category, label });
      if (!validation.ok) return fail(validation.error);
      const author = validateAuthorName(authorName);
      if (!author.ok) return fail(author.error);
      const note = createNote(db, validation.value, {
        author: "agent",
        authorName: author.value,
      });
      return { content: [{ type: "text", text: JSON.stringify(note) }] };
    },
  );

  server.registerTool(
    "update_note",
    {
      description: `Update an existing note, merging the supplied fields and tagging the row author "agent" with an auditable authorName. Writes notes only — never health records. ${AGENT_GUIDANCE}`,
      inputSchema: {
        id: z.number().describe("Note id from list_notes"),
        startDay: z.string().optional().describe("First date, YYYY-MM-DD"),
        endDay: z.string().optional().describe("Last date, YYYY-MM-DD"),
        category: NOTE_CATEGORY_SCHEMA.optional().describe(`One of: ${NOTE_CATEGORIES.join(", ")}`),
        label: z.string().optional().describe("Short neutral label, 1–140 characters"),
        authorName: z.string().optional().describe("Agent name, 1–64 characters (default agent)"),
      },
    },
    async ({ id, startDay, endDay, category, label, authorName }) => {
      if (!Number.isInteger(id) || id <= 0) return fail("note not found");
      const existing = getNote(db, id);
      if (!existing) return fail("note not found");
      const patch: Record<string, unknown> = {};
      if (startDay !== undefined) patch.startDay = startDay;
      if (endDay !== undefined) patch.endDay = endDay;
      if (category !== undefined) patch.category = category;
      if (label !== undefined) patch.label = label;
      const validation = validateNoteFields(patch, noteFields(existing));
      if (!validation.ok) return fail(validation.error);
      const author = validateAuthorName(authorName);
      if (!author.ok) return fail(author.error);
      const note = updateNote(db, id, validation.value, {
        author: "agent",
        authorName: author.value,
      });
      return { content: [{ type: "text", text: JSON.stringify(note) }] };
    },
  );

  server.registerTool(
    "save_briefing",
    {
      description: `Publish a dated briefing card for the owner: a short title, a summary that cites the specific nights and metrics it rests on, and the confounders behind them. Appends only — never health records. ${AGENT_GUIDANCE}`,
      inputSchema: {
        asOfDay: z.string().describe("Data as-of date, YYYY-MM-DD"),
        title: z.string().describe(`Title, 1–${120} characters`),
        summary: z.string().describe("Summary citing nights; up to 4000 characters"),
        citedNights: z.array(z.string()).optional().describe("Cited calendar dates, max 30"),
        citedMetrics: z
          .array(z.string())
          .optional()
          .describe(`Cited metric keys (${KNOWN_METRICS.join(", ")}), max 20`),
        authorName: z.string().optional().describe("Agent name, 1–64 characters (default agent)"),
      },
    },
    async ({ asOfDay, title, summary, citedNights, citedMetrics, authorName }) => {
      const author = validateAuthorName(authorName);
      if (!author.ok) return fail(author.error);
      const validation = validateBriefingFields({
        asOfDay,
        title,
        summary,
        ...(citedNights === undefined ? {} : { citedNights }),
        ...(citedMetrics === undefined ? {} : { citedMetrics }),
        authorName: author.value,
      });
      if (!validation.ok) return fail(validation.error);
      const briefing = createBriefing(db, validation.value);
      return { content: [{ type: "text", text: JSON.stringify(briefing) }] };
    },
  );

  server.registerTool(
    "update_profile",
    {
      description: `Update the owner profile context (goals, routine, medical context) by merging the supplied fields over the stored profile. Advice context only, never a diagnosis. ${AGENT_GUIDANCE}`,
      inputSchema: {
        goals: z.string().optional().describe("Owner goals, up to 1000 characters"),
        routine: z.string().optional().describe("Owner routine, up to 1000 characters"),
        medicalContext: z.string().optional().describe("Medical context, up to 1000 characters"),
      },
    },
    async ({ goals, routine, medicalContext }) => {
      const stored = getProfileContext(db);
      const merged = {
        goals: goals ?? stored.goals,
        routine: routine ?? stored.routine,
        medicalContext: medicalContext ?? stored.medicalContext,
      };
      const validation = validateProfileFields(merged);
      if (!validation.ok) return fail(validation.error);
      return {
        content: [{ type: "text", text: JSON.stringify(saveProfileContext(db, validation.value)) }],
      };
    },
  );

  return server;
}
