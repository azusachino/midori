import { describe, expect, test } from "bun:test";
import { metricSeriesStub, unitEvidenceStub } from "../../web/src/api/fixtures";
import {
  CHECK_ORDER,
  formatEvidenceHeading,
  formatEvidencePartialReason,
  formatEvidenceSummaryLine,
  formatEvidenceValue,
  formatEvidenceWeekdayDate,
  resolveChecks,
} from "../../web/src/lib/evidence";

describe("evidence and confounder check helpers", () => {
  test("resolveChecks returns all 7 B-C1–B-C7 checks in canonical order", () => {
    const hrv = metricSeriesStub("hrv_sdnn", "90d");
    const checks = resolveChecks(hrv);
    expect(checks.map((c) => c.key)).toEqual([...CHECK_ORDER]);

    const partial = checks.find((c) => c.key === "partial_nights");
    expect(partial?.flagged).toBe(true);
    expect(partial?.day).toBe("2026-03-01");
    expect(partial?.label).toContain("1 partial night skipped");
    expect(partial?.label).toContain("Mar 1");

    const clearChecks = checks.filter((c) => c.key !== "partial_nights");
    expect(clearChecks.every((c) => c.flagged === false)).toBe(true);
    expect(checks.find((c) => c.key === "low_trust")?.label).toBe("Trust: moderate");
  });

  test("resolveChecks handles device_change, low_trust, and daytime unit nouns", () => {
    const wrist = metricSeriesStub("wrist_temp", "90d");
    const wristChecks = resolveChecks(wrist);
    const devCheck = wristChecks.find((c) => c.key === "device_change");
    expect(devCheck?.flagged).toBe(true);
    expect(devCheck?.linkToDevices).toBe(true);
    expect(devCheck?.day).toBe("2026-02-22");

    const active = metricSeriesStub("active_kj", "90d");
    const activeChecks = resolveChecks(active);
    const partialDay = activeChecks.find((c) => c.key === "partial_nights");
    expect(partialDay?.flagged).toBe(false);
    expect(partialDay?.label).toBe("No partial days skipped");
    const lowTrust = activeChecks.find((c) => c.key === "low_trust");
    expect(lowTrust?.flagged).toBe(true);
    expect(lowTrust?.label).toBe("Trust: low");
  });

  test("unitEvidenceStub provides complete night, partial night, minor source, and empty gap day", () => {
    const withMinor = unitEvidenceStub("hrv_sdnn", "2026-02-25");
    expect(withMinor.unitKind).toBe("night");
    expect(withMinor.usable).toBe(true);
    expect(withMinor.samples.length).toBeGreaterThan(0);
    expect(withMinor.sleep).not.toBeNull();
    expect(withMinor.alsoRecordedBy.map((e) => e.label)).toEqual(["Synthetic Phone App"]);

    const partial = unitEvidenceStub("hrv_sdnn", "2026-03-01");
    expect(partial.usable).toBe(false);
    expect(partial.partialReason).toBe("export_cut");
    expect(formatEvidencePartialReason(partial.partialReason)).toBe("export taken before noon");

    const gap = unitEvidenceStub("hrv_sdnn", "2026-02-10");
    expect(gap.value).toBeNull();
    expect(gap.sampleCount).toBe(0);
    expect(gap.samples).toEqual([]);
    expect(formatEvidenceSummaryLine(gap, "ms")).toBe("No samples stored for this night");
  });

  test("evidence heading, value, and summary formatting", () => {
    expect(formatEvidenceWeekdayDate("2026-02-25")).toBe("Wed Feb 25");
    expect(formatEvidenceHeading("night", "2026-02-25", "hrv_sdnn")).toBe(
      "Night of Wed Feb 25 · HRV (SDNN)",
    );
    expect(formatEvidenceHeading("day", "2026-02-25", "steps")).toBe("Day of Wed Feb 25 · Steps");
    expect(formatEvidenceValue(39, "hrv_sdnn", "ms")).toBe("39 ms");

    const hrvEv = unitEvidenceStub("hrv_sdnn", "2026-02-25");
    const summary = formatEvidenceSummaryLine(hrvEv, "ms");
    expect(summary).toContain("median of 8 samples");
    expect(summary).toContain("21:00–09:00 Asia/Tokyo");
  });
});
