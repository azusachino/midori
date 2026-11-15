import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { METRICS } from "../domain/metrics";
import { listImports, listSources } from "../http/queries";

/**
 * MCP server (T20): read-only tools over the same queries as REST. Every
 * payload carries as-of + trust (shared contract — these tools return exactly
 * the REST DTOs). Transport-agnostic: stdio wiring lives in cli.ts mcp, the
 * streamable HTTP mount in src/mcp/http.ts (T21).
 */

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
      return {
        isError: true,
        content: [{ type: "text", text: "v1 derived reads arrive in slice 10" }],
      };
    },
  );

  server.registerTool(
    "deviations",
    {
      description:
        "Robust-z deviations (baseline = per-source median+MAD over anchor−90..−29, recent = last 14d of that source). Rows carry trust labels; cross_source suppression indicates a source coverage boundary, not proof of a device switch.",
      inputSchema: {},
    },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "v1 derived reads arrive in slice 10" }],
    }),
  );

  server.registerTool(
    "findings",
    {
      description:
        "Persisted finding ledger from the last import: deviation | recalibration (inferred source coverage boundary) | coverage (series start/gap), with evidence refs. A boundary does not establish a device switch or its cause; older persisted evidence may use stronger wording.",
      inputSchema: {},
    },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "v1 derived reads arrive in slice 10" }],
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
      isError: true,
      content: [{ type: "text", text: "v1 derived reads arrive in slice 10" }],
    }),
  );

  return server;
}
