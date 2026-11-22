import { describe, expect, test } from "bun:test";
import { BUILD_FALLBACK, getBuildInfo, resolveRevision, resolveVersion } from "./build";

const FULL_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("B-R5 build identity", () => {
  test("trims MIDORI_VERSION and prefers it over package.json", () => {
    expect(resolveVersion({ MIDORI_VERSION: "  1.2.3-rc9  " })).toBe("1.2.3-rc9");
  });

  test("falls back to package.json version when MIDORI_VERSION is empty or missing", () => {
    for (const env of [{}, { MIDORI_VERSION: "   " }]) {
      const version = resolveVersion(env);
      expect(version).not.toBe(BUILD_FALLBACK);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test("shortens a 40-char hex revision to 7 chars", () => {
    expect(resolveRevision({ MIDORI_REVISION: FULL_SHA })).toBe("0123456");
  });

  test("preserves the -dirty suffix while shortening", () => {
    expect(resolveRevision({ MIDORI_REVISION: `${FULL_SHA}-dirty` })).toBe("0123456-dirty");
    expect(resolveRevision({ MIDORI_REVISION: `  ${FULL_SHA}-dirty\n` })).toBe("0123456-dirty");
  });

  test("passes an already-short revision through and defaults empty to dev", () => {
    expect(resolveRevision({ MIDORI_REVISION: "abc1234-dirty" })).toBe("abc1234-dirty");
    expect(resolveRevision({})).toBe(BUILD_FALLBACK);
    expect(resolveRevision({ MIDORI_REVISION: "  " })).toBe(BUILD_FALLBACK);
  });

  test("does not mistake a non-hex tag for a full SHA", () => {
    expect(resolveRevision({ MIDORI_REVISION: "v0.0.1-rc4" })).toBe("v0.0.1-rc4");
  });

  test("getBuildInfo returns both fields for any environment", () => {
    expect(
      getBuildInfo({ MIDORI_VERSION: "0.0.1-rc4", MIDORI_REVISION: `${FULL_SHA}-dirty` }),
    ).toEqual({ version: "0.0.1-rc4", revision: "0123456-dirty" });
    expect(getBuildInfo()).toEqual({
      version: resolveVersion(process.env),
      revision: resolveRevision(process.env),
    });
  });
});
