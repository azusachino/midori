import { describe, expect, test } from "bun:test";
import { ApiError, createApiClient } from "../../web/src/api/client";
import { emptyProfileStub, healthStub } from "../../web/src/api/fixtures";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("B-R5 health client", () => {
  test("health requests /api/health and returns the build identity", async () => {
    const seen: string[] = [];
    const client = createApiClient({
      fetch: (async (url: string) => {
        seen.push(url);
        return json({ ok: true, version: "0.0.1-rc4", revision: "abc1234-dirty" });
      }) as never,
    });
    expect(await client.health()).toEqual({
      ok: true,
      version: "0.0.1-rc4",
      revision: "abc1234-dirty",
    });
    expect(seen).toEqual(["/api/health"]);
  });

  test("falls back to the dev stub on 404 only when fallbackOn404 is on", async () => {
    const failing = (async () => json({ error: "not found", retryable: false }, 404)) as never;
    const strict = createApiClient({ fetch: failing });
    const err = await strict.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);

    const dev = createApiClient({ fallbackOn404: true, fetch: failing });
    expect(await dev.health()).toEqual(healthStub());
  });
});

describe("B-P1 profile client", () => {
  test("profile GETs /api/profile and updateProfile PUTs JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "PUT") {
          return json({
            goals: "Sleep 7.5 h",
            routine: "",
            medicalContext: "",
            updatedAt: "2026-03-01T00:00:00.000Z",
          });
        }
        return json(emptyProfileStub());
      }) as never,
    });

    expect(await client.profile()).toEqual(emptyProfileStub());
    const saved = await client.updateProfile({
      goals: "Sleep 7.5 h",
      routine: "",
      medicalContext: "",
    });
    expect(saved.goals).toBe("Sleep 7.5 h");

    expect(calls[0]?.url).toBe("/api/profile");
    expect(calls[0]?.init.method).toBeUndefined();
    expect(calls[1]?.url).toBe("/api/profile");
    expect(calls[1]?.init.method).toBe("PUT");
    expectedPutBody(calls[1]?.init.body);
  });

  test("updateProfile surfaces a read-only 405 as a typed body", async () => {
    const client = createApiClient({
      fetch: (async () => json({ error: "profile is read-only", retryable: false }, 405)) as never,
    });
    const err = await client
      .updateProfile({ goals: "a", routine: "b", medicalContext: "c" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(405);
    expect((err as ApiError).body).toEqual({ error: "profile is read-only", retryable: false });
  });

  test("profile falls back to an empty profile on 404 only in dev mode", async () => {
    const failing = (async () => json({ error: "not found", retryable: false }, 404)) as never;
    const dev = createApiClient({ fallbackOn404: true, fetch: failing });
    expect(await dev.profile()).toEqual(emptyProfileStub());
  });
});

function expectedPutBody(body: BodyInit | null | undefined): void {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  expect(JSON.parse(body)).toEqual({ goals: "Sleep 7.5 h", routine: "", medicalContext: "" });
}
