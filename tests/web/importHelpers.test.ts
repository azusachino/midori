import { describe, expect, test } from "bun:test";
import type { ImportDTO } from "../../web/src/api/types";
import {
  formatDurationClock,
  formatDurationMs,
  formatMegabytes,
  isActiveImportStatus,
  isBadExportMessage,
  resolveJobStage,
} from "../../web/src/lib/import-helpers";

function row(overrides: Partial<ImportDTO>): ImportDTO {
  return {
    id: 1,
    zipName: "export.zip",
    zipSize: 1024,
    status: "queued",
    error: null,
    exportVersion: "11",
    recordsSeen: null,
    recordsInserted: null,
    recordsDeduped: null,
    newUsableNights: null,
    newEpochs: [],
    durationMs: null,
    createdAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("import-helpers", () => {
  test("isActiveImportStatus identifies running vs terminal statuses", () => {
    expect(isActiveImportStatus("queued")).toBe(true);
    expect(isActiveImportStatus("unpacking")).toBe(true);
    expect(isActiveImportStatus("parsing")).toBe(true);
    expect(isActiveImportStatus("storing")).toBe(true);
    expect(isActiveImportStatus("deriving")).toBe(true);
    expect(isActiveImportStatus("done")).toBe(false);
    expect(isActiveImportStatus("failed")).toBe(false);
  });

  test("resolveJobStage prefers v1 stage and progress when present", () => {
    expect(resolveJobStage(row({ status: "parsing", stage: "parsing", progress: 64 }))).toEqual({
      stageIndex: 2,
      stageKey: "parsing",
      progressPct: 64,
      barValue: 64,
    });

    expect(resolveJobStage(row({ status: "storing", stage: "deriving", progress: 120 }))).toEqual({
      stageIndex: 4,
      stageKey: "deriving",
      progressPct: 100,
      barValue: 100,
    });
  });

  test("resolveJobStage falls back cleanly when v0 server omits stage and progress", () => {
    expect(resolveJobStage(row({ status: "queued" }))).toEqual({
      stageIndex: 0,
      stageKey: "queued",
      progressPct: null,
      barValue: 10,
    });

    expect(resolveJobStage(row({ status: "unpacking" }))).toEqual({
      stageIndex: 1,
      stageKey: "unpacking",
      progressPct: null,
      barValue: 30,
    });

    expect(resolveJobStage(row({ status: "parsing" }))).toEqual({
      stageIndex: 2,
      stageKey: "parsing",
      progressPct: null,
      barValue: 50,
    });

    expect(resolveJobStage(row({ status: "done" }))).toEqual({
      stageIndex: 5,
      stageKey: "deriving",
      progressPct: null,
      barValue: 100,
    });
  });

  test("isBadExportMessage matches v0 zip errors and v1 messages", () => {
    expect(isBadExportMessage("no export.xml found in archive (seen: [a.txt])")).toBe(true);
    expect(isBadExportMessage("End of central directory record signature not found")).toBe(true);
    expect(isBadExportMessage("interrupted by restart")).toBe(false);
    expect(isBadExportMessage(null)).toBe(false);
  });

  test("byte and duration formatters produce expected strings", () => {
    expect(formatMegabytes(5.2 * 1024 * 1024)).toBe("5.2 MB");
    expect(formatMegabytes(84 * 1024 * 1024)).toBe("84 MB");
    expect(formatDurationClock(0)).toBe("0:00");
    expect(formatDurationClock(134)).toBe("2:14");
    expect(formatDurationMs(null)).toBe("—");
    expect(formatDurationMs(820)).toBe("820 ms");
    expect(formatDurationMs(2300)).toBe("2.3 s");
  });
});
