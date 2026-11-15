import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { METRICS } from "../domain/metrics";
import {
  briefing,
  DEFAULT_DEVIATION_DAYS,
  listDeviations,
  listFindings,
  listImports,
  listSources,
  metricDaily,
} from "../http/queries";

/**
 * MCP server (T20): read-only tools over the same queries as REST. Every
 * payload carries as-of + trust (shared contract — these tools return exactly
 * the REST DTOs). Transport-agnostic: stdio wiring lives in cli.ts mcp, the
 * streamable HTTP mount in src/mcp/http.ts (T21).
 */

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("calendar day, YYYY-MM-DD (record-local)");

export function createMcpServer({ db }: { db: Database }): McpServer {
  const server = new McpServer(
    { name: "midori", version: "0.1.0" },
    {
      instructions:
        "Read-only access to an Apple Health warehouse. Never a substitute for medical advice.",
    },
  );

  server.registerTool(
    "list_imports",
    {
      description:
        "Import history: newest first. Status lifecycle queued→unpacking→parsing→storing→done|failed.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(listImports(db)) }],
    }),
  );

  server.registerTool(
    "list_sources",
    {
      description:
        "Devices/apps in the warehouse (record counts, first/last seen). Useful for device-switch questions.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(listSources(db)) }],
    }),
  );

  server.registerTool(
    "metric_daily",
    {
      description:
        "Daily series per source for one metric, with unit, method, trust label and per-source as-of day. Known metrics: " +
        Object.keys(METRICS).join(", "),
      inputSchema: {
        metric: z.string().describe("metric key, e.g. wrist_temp, sleep_h, rhr"),
      },
    },
    async ({ metric }) => {
      if (!(metric in METRICS)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `unknown metric: ${metric}`,
                known: Object.keys(METRICS),
              }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(metricDaily(db, metric)) }] };
    },
  );

  server.registerTool(
    "deviations",
    {
      description:
        "Robust-z deviations (baseline = per-source median+MAD over anchor−90..−29, recent = last 14d of that source). Rows carry trust labels; suppressed rows carry a reason (cross_source = device switch inside the window).",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(DEFAULT_DEVIATION_DAYS)
          .describe(
            "only rows whose per-source as-of is within this many days of the global anchor",
          ),
      },
    },
    async ({ days }) => ({
      content: [{ type: "text", text: JSON.stringify(listDeviations(db, days)) }],
    }),
  );

  server.registerTool(
    "findings",
    {
      description:
        "Persisted finding ledger from the last import: deviation | recalibration (device switch) | coverage (series start/gap), with evidence refs.",
      inputSchema: {
        since: daySchema.optional().describe("only findings anchored on/after this day"),
      },
    },
    async ({ since }) => ({
      content: [{ type: "text", text: JSON.stringify(listFindings(db, since)) }],
    }),
  );

  server.registerTool(
    "briefing",
    {
      description:
        "One call for the whole story: anchor day, per-metric as-of, finding ledger, sources, last import + staleness hint. Start here.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(briefing(db)) }],
    }),
  );

  return server;
}
