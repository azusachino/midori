import { describe, expect, test } from "bun:test";
import { IMPORT_STATUSES, MAX_UPLOAD_BYTES, trustFields } from "./api";
import { METRICS, trustFor } from "./metrics";

describe("api contracts", () => {
  test("import status enum matches the import-job state machine", () => {
    expect([...IMPORT_STATUSES]).toEqual([
      "queued",
      "unpacking",
      "parsing",
      "storing",
      "done",
      "failed",
    ]);
  });

  test("upload cap is 512 MiB (typical export is ~66 MB)", () => {
    expect(MAX_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
  });

  test("trustFields carries label + note into DTOs", () => {
    expect(trustFields("steps")).toEqual({
      trust: "high",
      trustNote: "Step counts are accurate at walking paces.",
    });
    expect(trustFields("active_kj").trust).toBe("low");
  });
});

describe("metric registry", () => {
  test("every spec has key/unit/method and self-consistent key", () => {
    for (const [key, spec] of Object.entries(METRICS)) {
      expect(spec.key).toBe(key);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(["median", "sum"]).toContain(spec.method);
      expect(spec.types.length).toBeGreaterThan(0);
    }
  });

  test("pinned trust grades from the accuracy literature", () => {
    expect(METRICS.steps?.trust).toBe("high");
    expect(METRICS.rhr?.trust).toBe("high");
    expect(METRICS.heart_rate?.trust).toBe("high");
    expect(METRICS.hrv_sdnn?.trust).toBe("moderate");
    expect(METRICS.hrv_rmssd?.trust).toBe("moderate");
    expect(METRICS.active_kj?.trust).toBe("low");
  });

  test("HRV and wrist temp are night-only", () => {
    expect(METRICS.hrv_sdnn?.nightOnly).toBe(true);
    expect(METRICS.hrv_rmssd?.nightOnly).toBe(true);
    expect(METRICS.wrist_temp?.nightOnly).toBe(true);
    expect(METRICS.steps?.nightOnly).toBe(false);
  });

  test("unknown metric gets a cautious default", () => {
    expect(trustFor("something_new")).toEqual({
      label: "moderate",
      note: "Unreviewed metric; treat trends with caution.",
    });
  });
});
