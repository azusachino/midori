import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENT_GUIDANCE } from "../domain/api";
import { METRICS } from "../domain/metrics";
import { getChanges, getEpochs, getNights, getSeries, listImports } from "../http/queries";
import {
  CONTEXT_DEFAULT_DAYS,
  CONTEXT_MAX_DAYS,
  CONTEXT_MIN_DAYS,
  caveatsFor,
  getHealthContext,
  isValidContextDays,
} from "../stats/context";
import { isCalendarDay, listNotes } from "../stats/notes";

const KNOWN_METRICS = Object.keys(METRICS);

/** Read-only MCP tools over the same query functions used by REST. */
export function createMcpServer({ db }: { db: Database }): McpServer {
  const server = new McpServer(
    { name: "midori", version: "0.1.0" },
    {
      instructions:
        "Read-only access to an Apple Health warehouse. Never a substitute for medical advice. " +
        "Start with health_context for a holistic dossier (findings, long-term baselines, aligned " +
        "nights, profile); use changes for quick ranked findings. " +
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
    "list_imports",
    {
      description: `Import history, newest first, including status and record counts. ${AGENT_GUIDANCE}`,
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(listImports(db)) }] }),
  );

  return server;
}
