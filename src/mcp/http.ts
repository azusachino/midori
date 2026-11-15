import type { Database } from "bun:sqlite";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context, Hono } from "hono";
import { createMcpServer } from "./server";

/**
 * Streamable HTTP transport (T21): the same read-only tools as stdio,
 * mounted at /mcp on the Hono app. Stateless mode (no session id) — each
 * POST gets a fresh server+transport pair, which is correct for a
 * single-user deployment and lets any machine's agent client connect.
 *
 * Binding is the deployment's security boundary: v0 serves tailnet-only
 * (design.md Deployment); no auth layer — never expose /mcp beyond the
 * tailnet. GET/DELETE (SSE stream / session termination) are not offered:
 * this server answers one-shot JSON responses.
 */

export const MCP_HTTP_PATH = "/mcp";

async function handle(c: Context, db: Database): Promise<Response> {
  // Key omitted (not set to undefined) for stateless mode: exactOptionalPropertyTypes.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createMcpServer({ db });
  c.header("Cache-Control", "no-store");
  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } finally {
    // Stateless: the transport's work ends with the response.
    await transport.close().catch(() => undefined);
  }
}

export function mountMcp(app: Hono, opts: { db: Database; path?: string }): void {
  const path = opts.path ?? MCP_HTTP_PATH;
  const { db } = opts;
  app.post(path, (c) => handle(c, db));
  // Not a stateful session server: no SSE stream, nothing to terminate.
  app.get(path, (c) =>
    c.json({ error: "GET not supported; POST JSON-RPC messages only", retryable: false }, 405),
  );
  app.delete(path, (c) =>
    c.json({ error: "no sessions to terminate (stateless server)", retryable: false }, 405),
  );
}
