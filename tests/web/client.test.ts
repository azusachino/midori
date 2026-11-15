import { describe, expect, test } from "bun:test";
import { ApiError, createApiClient, ImportFailedError } from "../../web/src/api/client";

/**
 * T15 client contract: typed error bodies, network/abort classification, and the
 * import job poll (resolve on done, typed throw on failed, prompt stop on abort).
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function stub(...responses: Response[]) {
  let i = 0;
  return (async () => responses[Math.min(i++, responses.length - 1)] as Response) as never;
}

describe("api client", () => {
  test("requests the documented paths and passes days through", async () => {
    const seen: string[] = [];
    const c = createApiClient({
      fetch: (async (url: string) => {
        seen.push(url);
        return json([]);
      }) as never,
    });
    await c.deviations(30);
    await c.metricDaily("hrv_sdnn");
    await c.briefing();
    expect(seen).toEqual([
      "/api/deviations?days=30",
      "/api/metrics/hrv_sdnn/daily",
      "/api/briefing",
    ]);
  });

  test("typed ErrorResponse body is surfaced on HTTP failure", async () => {
    const c = createApiClient({
      fetch: stub(json({ error: "unknown metric: nope", retryable: false }, 404)),
    });
    const err = await c.metricDaily("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body?.error).toBe("unknown metric: nope");
  });

  test("a refused connection is a network error, not a crash", async () => {
    const c = createApiClient({
      fetch: (async () => {
        throw new TypeError("connection refused");
      }) as never,
    });
    const err = await c.sources().catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("network");
  });

  test("pollImport resolves on done", async () => {
    const c = createApiClient({
      fetch: stub(json([{ id: 2, status: "done", error: null }])),
    });
    const row = await c.pollImport(2, { intervalMs: 1 });
    expect(row.status).toBe("done");
  });

  test("pollImport walks status transitions and reports each one", async () => {
    const seen: string[] = [];
    const c = createApiClient({
      fetch: stub(
        json([{ id: 3, status: "parsing", error: null }]),
        json([{ id: 3, status: "storing", error: null }]),
        json([{ id: 3, status: "done", error: null }]),
      ),
    });
    await c.pollImport(3, { intervalMs: 1, onUpdate: (r) => seen.push(r.status) });
    expect(seen).toEqual(["parsing", "storing", "done"]);
  });

  test("pollImport throws a typed error carrying row.error on failed", async () => {
    const c = createApiClient({
      fetch: stub(json([{ id: 4, status: "failed", error: "bad zip" }])),
    });
    const err = await c.pollImport(4, { intervalMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportFailedError);
    expect((err as ImportFailedError).reason).toBe("bad zip");
    expect((err as ImportFailedError).importId).toBe(4);
  });

  test("pollImport stops promptly on abort instead of waiting out the interval", async () => {
    const c = createApiClient({
      fetch: stub(json([{ id: 5, status: "queued", error: null }])),
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const started = Date.now();
    const err = await c
      .pollImport(5, { intervalMs: 60_000, signal: ac.signal })
      .catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  test("upload POSTs the raw zip with content-type and x-zip-name, and resolves the 202 receipt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const c = createApiClient({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return json({ importId: 7, status: "queued" }, 202);
      }) as never,
    });
    const body = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: "application/zip" });
    const receipt = await c.upload(body, { name: "export.zip" });
    expect(receipt).toEqual({ importId: 7, status: "queued" });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { url: string; init: RequestInit };
    expect(call.url).toBe("/api/imports");
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe(body);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["x-zip-name"]).toBe("export.zip");
  });

  test("upload omits x-zip-name when no name is given", async () => {
    let headers: Record<string, string> = {};
    const c = createApiClient({
      fetch: (async (_url: string, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return json({ importId: 8, status: "queued" }, 202);
      }) as never,
    });
    await c.upload(new Blob([new Uint8Array([1])]));
    expect("x-zip-name" in headers).toBe(false);
    expect(headers["content-type"]).toBe("application/zip");
  });

  test("upload maps 415 to a typed http ApiError carrying the server body", async () => {
    const c = createApiClient({
      fetch: stub(
        json(
          {
            error: "content-type must be application/zip (send the export.zip as the raw body)",
            retryable: false,
          },
          415,
        ),
      ),
    });
    const err = await c.upload(new Blob([new Uint8Array([1])])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(415);
    expect((err as ApiError).body?.retryable).toBe(false);
  });

  test("upload maps 409 to a retryable http ApiError", async () => {
    const c = createApiClient({
      fetch: stub(json({ error: "an import is already running", retryable: true }, 409)),
    });
    const err = await c.upload(new Blob([new Uint8Array([1])])).catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body?.retryable).toBe(true);
  });

  test("upload: a refused connection is a network error", async () => {
    const c = createApiClient({
      fetch: (async () => {
        throw new TypeError("connection refused");
      }) as never,
    });
    const err = await c.upload(new Blob([new Uint8Array([1])])).catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("network");
  });
});
