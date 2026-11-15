import { describe, expect, test } from "bun:test";
import {
  ApiError,
  createApiClient,
  ImportFailedError,
  type XhrLike,
  type XhrProgressEventLike,
} from "../../web/src/api/client";
import { loadShellChanges } from "../../web/src/lib/shell-context";

/**
 * v1 API client contract: routes, production-default 404 error surfacing,
 * dev-only 404 stub fallback, typed error bodies, network/abort classification,
 * and import job poll/upload.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function stub(...responses: Response[]) {
  let i = 0;
  return (async () =>
    (responses[Math.min(i++, responses.length - 1)] as Response).clone()) as never;
}

describe("api client (v1)", () => {
  test("requests all documented v1 routes", async () => {
    const seen: string[] = [];
    const c = createApiClient({
      fetch: (async (url: string) => {
        seen.push(url);
        return json({});
      }) as never,
    });
    await c.changes();
    await c.metricsIndex();
    await c.metricSeries("hrv_sdnn", "90d");
    await c.unitEvidence("hrv_sdnn", "2026-03-01");
    await c.epochs();
    await c.nights("2026-02-01", "2026-03-01");
    await c.importDetail(4);
    await c.retryImport(4);

    expect(seen).toEqual([
      "/api/changes",
      "/api/metrics",
      "/api/metrics/hrv_sdnn?range=90d",
      "/api/metrics/hrv_sdnn/units/2026-03-01",
      "/api/epochs",
      "/api/nights?from=2026-02-01&to=2026-03-01",
      "/api/imports/4",
      "/api/imports/4/retry",
    ]);
  });

  test("production path (default fallbackOn404=false) surfaces 404 as read-error state instead of synthetic data", async () => {
    const c = createApiClient({
      fetch: stub(json({ error: "not found", retryable: false }, 404)),
    });

    const err = await c.changes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(404);

    const shellState = await loadShellChanges(c);
    expect(shellState.status).toBe("error");
    expect(shellState.status === "error" ? shellState.changes : null).toBeNull();
    expect(shellState.status === "error" ? shellState.errorMessage : null).toBe("not found");

    const metricsErr = await c.metricsIndex().catch((e: unknown) => e);
    expect((metricsErr as ApiError).status).toBe(404);

    const epochsErr = await c.epochs().catch((e: unknown) => e);
    expect((epochsErr as ApiError).status).toBe(404);
  });

  test("explicit fallbackOn404=true falls back to synthetic stub on unimplemented v1 endpoints when imports exist", async () => {
    const c = createApiClient({
      fallbackOn404: true,
      fetch: (async (url: string) => {
        if (url === "/api/imports") {
          return json([
            { id: 1, zipName: "fixture.zip", status: "done", createdAt: "2026-03-02T08:00:00Z" },
          ]);
        }
        return json({ error: "not found", retryable: false }, 404);
      }) as never,
    });

    const changes = await c.changes();
    expect(changes.hasImports).toBe(true);
    expect(changes.asOfDay).toBe("2026-03-01");
    expect(changes.primaryWatch?.label).toBe("Synthetic Watch B");

    const series = await c.metricSeries("wrist_temp", "90d");
    expect(series.metric).toBe("wrist_temp");
    expect(series.units.length).toBeGreaterThan(0);
  });

  test("fallbackOn404=true returns empty state when /api/imports is empty", async () => {
    const c = createApiClient({
      fallbackOn404: true,
      fetch: (async (url: string) => {
        if (url === "/api/imports") return json([]);
        return json({ error: "not found", retryable: false }, 404);
      }) as never,
    });

    const changes = await c.changes();
    expect(changes.hasImports).toBe(false);
    expect(changes.asOfDay).toBeNull();
  });

  test("unknown metric key still throws 404 ApiError even with fallbackOn404=true", async () => {
    const c = createApiClient({
      fallbackOn404: true,
      fetch: stub(json({ error: "unknown metric: nope", retryable: false }, 404)),
    });
    const err = await c.metricSeries("nope", "180d").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(404);
  });

  test("typed ErrorResponse body is surfaced on HTTP failure", async () => {
    const c = createApiClient({
      fallbackOn404: false,
      fetch: stub(json({ error: "unknown metric: nope", retryable: false }, 404)),
    });
    const err = await c.metricSeries("hrv_sdnn").catch((e: unknown) => e);
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
    const err = await c.changes().catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("network");
  });

  test("importDetail falls back to GET /api/imports when GET /api/imports/:id returns 404", async () => {
    const c = createApiClient({
      fetch: (async (url: string) => {
        if (url === "/api/imports/2") return json({ error: "not found", retryable: false }, 404);
        if (url === "/api/imports") return json([{ id: 2, status: "done", error: null }]);
        return json({}, 404);
      }) as never,
    });
    const row = await c.importDetail(2);
    expect(row.id).toBe(2);
    expect(row.status).toBe("done");
  });

  test("pollImport resolves on done", async () => {
    const c = createApiClient({
      fetch: stub(json({ id: 2, status: "done", error: null })),
    });
    const row = await c.pollImport(2, { intervalMs: 1 });
    expect(row.status).toBe("done");
  });

  test("pollImport walks status transitions and reports each one", async () => {
    const seen: string[] = [];
    const c = createApiClient({
      fetch: stub(
        json({ id: 3, status: "parsing", error: null }),
        json({ id: 3, status: "deriving", error: null }),
        json({ id: 3, status: "done", error: null }),
      ),
    });
    await c.pollImport(3, { intervalMs: 1, onUpdate: (r) => seen.push(r.status) });
    expect(seen).toEqual(["parsing", "deriving", "done"]);
  });

  test("pollImport throws a typed error carrying row.error on failed", async () => {
    const c = createApiClient({
      fetch: stub(json({ id: 4, status: "failed", error: "bad zip" })),
    });
    const err = await c.pollImport(4, { intervalMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportFailedError);
    expect((err as ImportFailedError).reason).toBe("bad zip");
    expect((err as ImportFailedError).importId).toBe(4);
  });

  test("pollImport stops promptly on abort instead of waiting out the interval", async () => {
    const c = createApiClient({
      fetch: stub(json({ id: 5, status: "queued", error: null })),
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

  test("upload maps 409 to a retryable http ApiError", async () => {
    const c = createApiClient({
      fetch: stub(json({ error: "an import is already running", retryable: true }, 409)),
    });
    const err = await c.upload(new Blob([new Uint8Array([1])])).catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body?.retryable).toBe(true);
  });

  test("importDetail falls back to GET /api/imports when /api/imports/:id returns 404", async () => {
    const c = createApiClient({
      fetch: (async (url: string) => {
        if (url === "/api/imports/9") return json({ error: "not found", retryable: false }, 404);
        if (url === "/api/imports") return json([{ id: 9, status: "done", error: null }]);
        return json({}, 500);
      }) as never,
    });
    const row = await c.importDetail(9);
    expect(row.id).toBe(9);
    expect(row.status).toBe("done");
  });

  test("retryImport resolves 202 receipt and surfaces 410 as http ApiError", async () => {
    const okClient = createApiClient({
      fetch: stub(json({ importId: 12, status: "queued" }, 202)),
    });
    expect(await okClient.retryImport(12)).toEqual({ importId: 12, status: "queued" });

    const goneClient = createApiClient({
      fetch: stub(json({ error: "upload spool expired", retryable: false }, 410)),
    });
    const err = await goneClient.retryImport(12).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("http");
    expect((err as ApiError).status).toBe(410);
  });

  test("XHR upload emits byte progress and resolves 202 receipt", async () => {
    const opened: Array<{ method: string; url: string }> = [];
    const headers: Record<string, string> = {};
    const xhr: XhrLike = {
      upload: { onprogress: null },
      onload: null,
      onerror: null,
      onabort: null,
      status: 202,
      responseText: JSON.stringify({ importId: 21, status: "queued" }),
      open(method, url) {
        opened.push({ method, url });
      },
      setRequestHeader(name, value) {
        headers[name] = value;
      },
      send() {
        xhr.upload.onprogress?.({
          lengthComputable: true,
          loaded: 512,
          total: 1024,
        } as XhrProgressEventLike);
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1024, total: 1024 });
        xhr.onload?.();
      },
      abort() {},
    };

    const progress: Array<[number, number]> = [];
    const c = createApiClient({ createXhr: () => xhr });
    const receipt = await c.upload(new Blob([new Uint8Array([1, 2])]), {
      name: "synth.zip",
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    expect(opened).toEqual([{ method: "POST", url: "/api/imports" }]);
    expect(headers["content-type"]).toBe("application/zip");
    expect(headers["x-zip-name"]).toBe("synth.zip");
    expect(progress).toEqual([
      [512, 1024],
      [1024, 1024],
    ]);
    expect(receipt).toEqual({ importId: 21, status: "queued" });
  });

  test("XHR upload maps 400/409 http errors, network drops, and aborts", async () => {
    const makeErrorXhr = (
      mode: "http" | "network" | "abort",
      status = 400,
      body: unknown = { error: "not a health export", retryable: false },
    ): XhrLike => {
      let aborted = false;
      const xhr: XhrLike = {
        upload: { onprogress: null },
        onload: null,
        onerror: null,
        onabort: null,
        status,
        responseText: JSON.stringify(body),
        open() {},
        setRequestHeader() {},
        send() {
          if (aborted) return;
          if (mode === "http") xhr.onload?.();
          else if (mode === "network") xhr.onerror?.();
        },
        abort() {
          aborted = true;
          xhr.onabort?.();
        },
      };
      return xhr;
    };

    const badClient = createApiClient({ createXhr: () => makeErrorXhr("http", 400) });
    const badErr = await badClient.upload(new Blob(["x"])).catch((e: unknown) => e);
    expect((badErr as ApiError).kind).toBe("http");
    expect((badErr as ApiError).status).toBe(400);

    const netClient = createApiClient({ createXhr: () => makeErrorXhr("network") });
    const netErr = await netClient.upload(new Blob(["x"])).catch((e: unknown) => e);
    expect((netErr as ApiError).kind).toBe("network");

    const abortClient = createApiClient({ createXhr: () => makeErrorXhr("abort") });
    const ac = new AbortController();
    const promise = abortClient.upload(new Blob(["x"]), { signal: ac.signal });
    ac.abort();
    const abortErr = await promise.catch((e: unknown) => e);
    expect((abortErr as ApiError).kind).toBe("aborted");
  });
});
