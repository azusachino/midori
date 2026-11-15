import { describe, expect, test } from "bun:test";
import { epochsStub, singleEpochStub } from "../../web/src/api/fixtures";
import {
  buildDevicesSummary,
  buildDevicesTable,
  buildDeviceTimelineModel,
  buildTimelineRuns,
  formatBaselineLabel,
  formatEpochSpan,
  formatOsUpdateLabel,
  formatSeamDescription,
  organizeEpochs,
} from "../../web/src/lib/devices";

describe("Devices page helpers", () => {
  test("organizeEpochs orders primary epochs newest-first, splits minor sources, and detects single-epoch", () => {
    const dto = epochsStub(true);
    const organized = organizeEpochs(dto);

    expect(organized.isSingleEpoch).toBe(false);
    // Watch B & Phone both end on 2026-03-01 (Watch B starts later -> first), Watch A ends 2026-02-02
    expect(organized.primaryEpochs.map((e) => e.id)).toEqual([2, 3, 1]);
    expect(organized.minorEpochs.map((e) => e.label)).toEqual(["Synthetic Phone App"]);

    const single = organizeEpochs(singleEpochStub());
    expect(single.isSingleEpoch).toBe(true);
    expect(single.primaryEpochs).toHaveLength(1);
    expect(single.minorEpochs).toHaveLength(0);
  });

  test("buildTimelineRuns renders sparse or minor epochs as dots and contiguous stretches as bars (B-D3)", () => {
    const dto = epochsStub(true);
    const watchB = dto.epochs.find((e) => e.id === 2);
    const minorApp = dto.epochs.find((e) => e.id === 4);
    if (!watchB || !minorApp) throw new Error("expected watchB and minorApp");

    const watchRuns = buildTimelineRuns(watchB);
    expect(watchRuns).toHaveLength(1);
    expect(watchRuns[0]?.shape).toBe("bar");
    expect(watchRuns[0]?.startDay).toBe("2026-01-24");
    expect(watchRuns[0]?.endDay).toBe("2026-03-01");

    const appRuns = buildTimelineRuns(minorApp);
    expect(appRuns).toHaveLength(1);
    expect(appRuns[0]?.shape).toBe("dots");
    expect(appRuns[0]?.days).toEqual(["2025-09-12", "2025-11-03", "2026-01-08", "2026-02-19"]);

    // Non-minor epoch with isolated 1-2 day pockets also uses dots cleanly
    const sparseNonMinor = {
      ...watchB,
      id: 99,
      daysPresent: ["2026-01-01", "2026-01-10", "2026-02-01", "2026-02-02"],
      daysPresentCount: 4,
    };
    const sparseRuns = buildTimelineRuns(sparseNonMinor);
    expect(sparseRuns.every((r) => r.shape === "dots")).toBe(true);
  });

  test("buildDeviceTimelineModel packs overlapping epochs onto distinct subtracks and collects OS marks", () => {
    const dto = epochsStub(true);
    const model = buildDeviceTimelineModel(dto.epochs);

    expect(model.lanes.map((l) => l.key)).toEqual(["watch", "phone", "app"]);
    // Watch A (2025-08-15..2026-02-02) and Watch B (2026-01-24..2026-03-01) overlap -> 2 rows in watch lane
    const watchLane = model.lanes.find((l) => l.key === "watch");
    expect(watchLane?.rowCount).toBe(2);
    expect(model.totalRows).toBe(4); // 2 watch subtracks + 1 phone + 1 app
    expect(model.osMarks).toHaveLength(3);
    expect(model.hasMinorEpochs).toBe(true);
  });

  test("formatters emit canonical baseline, offset (B-D6), step (B-D7), OS update (B-D8), and table rows", () => {
    const dto = epochsStub(true);
    const watchB = dto.epochs.find((e) => e.id === 2);
    if (!watchB) throw new Error("expected watchB");

    const hrvRow = watchB.metrics.find((m) => m.metric === "hrv_sdnn");
    const tempRow = watchB.metrics.find((m) => m.metric === "wrist_temp");
    if (!hrvRow?.seamFromPrevious || !tempRow?.seamFromPrevious) {
      throw new Error("expected seam rows on watchB");
    }

    expect(formatBaselineLabel(hrvRow)).toBe("full");
    expect(formatBaselineLabel(tempRow)).toBe("learning 9/14");
    expect(formatBaselineLabel({ baselineState: null, warmup: null })).toBe("—");
    expect(formatSeamDescription("hrv_sdnn", hrvRow.seamFromPrevious)).toBe(
      "offset −4.0 ms (n=10 shared days)",
    );
    expect(formatSeamDescription("wrist_temp", tempRow.seamFromPrevious)).toBe(
      "step +0.52 °C — device or you, can't separate",
    );
    expect(
      formatEpochSpan(watchB.firstDay, watchB.lastDay, dto.asOfDay, watchB.daysPresentCount),
    ).toBe("since Jan 24 · 37 days");
    const osEv = watchB.osUpdates[0];
    if (!osEv) throw new Error("expected OS update");
    expect(formatOsUpdateLabel(osEv)).toBe("10.4 → 11.0 on Feb 26");

    expect(buildDevicesSummary(dto.epochs)).toContain("3 primary or secondary epochs");
    expect(buildDevicesSummary(dto.epochs)).toContain("1 occasional source");

    const withMinorOs = epochsStub(true);
    const minorEp = withMinorOs.epochs.find((e) => e.minor);
    if (!minorEp) throw new Error("expected minor epoch");
    minorEp.osUpdates = [
      { epochId: minorEp.id, day: minorEp.firstDay, fromSw: "10.0", toSw: "10.1" },
    ];
    const minorModel = buildDeviceTimelineModel(withMinorOs.epochs);
    expect(minorModel.osMarks).toHaveLength(buildDeviceTimelineModel(dto.epochs).osMarks.length);

    const table = buildDevicesTable(dto.epochs);
    expect(table.rows).toHaveLength(4);
    expect(table.rows.some((r) => r.status === "minor")).toBe(true);
  });
});
