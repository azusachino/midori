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
});
