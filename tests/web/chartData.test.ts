import { describe, expect, test } from "bun:test";
import {
  type BoundarySurface,
  buildChartData,
  dayToTs,
  drawBoundaryDays,
  tsToDay,
  valueFmt,
} from "../../web/src/components/chartData";

const SRC_A = "watch-a";
const SRC_B = "watch-b";

describe("buildChartData", () => {
  test("aligns sparse series onto the sorted union of days with null gaps", () => {
    const { data, labels } = buildChartData([
      {
        label: SRC_A,
        points: [
          { day: "2026-01-02", value: 36.4 },
          { day: "2026-01-01", value: 36.3 },
        ],
      },
      { label: SRC_B, points: [{ day: "2026-01-03", value: 36.5 }] },
    ]);
    const [xs, a, b] = data as unknown as (number | null)[][];
    expect(xs).toEqual([dayToTs("2026-01-01"), dayToTs("2026-01-02"), dayToTs("2026-01-03")]);
    expect(a).toEqual([36.3, 36.4, null]);
    expect(b).toEqual([null, null, 36.5]);
    expect(labels).toEqual([SRC_A, SRC_B]);
  });

  test("banded series contributes hidden low/high series and a band pair", () => {
    const { data, series, bands, labels } = buildChartData([
      {
        label: SRC_A,
        points: [{ day: "2026-01-01", value: 70 }],
        band: { low: 60, high: 80 },
      },
    ]);
    // data: [xs, low, value, high]
    const rows = data as unknown as (number | null)[][];
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual([60]);
    expect(rows[2]).toEqual([70]);
    expect(rows[3]).toEqual([80]);
    expect(bands).toEqual([{ series: [1, 3] }]);
    // legend-visible series: only the value series
    expect(labels).toEqual([SRC_A]);
    expect(series[1]?.show).toBe(false);
    expect(series[2]?.label).toBe(SRC_A);
    expect(series[2]?.show).not.toBe(false);
    expect(series[3]?.show).toBe(false);
  });

  test("unsorted input days are normalized", () => {
    const { data } = buildChartData([
      {
        label: SRC_A,
        points: [
          { day: "2026-02-02", value: 1 },
          { day: "2026-01-30", value: 2 },
        ],
      },
    ]);
    expect((data[0] as number[]).map(tsToDay)).toEqual(["2026-01-30", "2026-02-02"]);
  });
});

describe("drawBoundaryDays", () => {
  interface Recorded {
    ops: string[];
    styles: string[];
    dashes: number[][];
  }

  function fakeSurface(days: string[], xs: number[]): { u: BoundarySurface; rec: Recorded } {
    const rec: Recorded = { ops: [], styles: [], dashes: [] };
    const posOf = new Map(days.map((d, i) => [d, 100 + i * 50]));
    const tsToDayLocal = (ts: number) => tsToDay(ts);
    let style = "";
    const ctx = {
      save: () => rec.ops.push("save"),
      restore: () => rec.ops.push("restore"),
      beginPath: () => rec.ops.push("begin"),
      moveTo: (x: number, y: number) => rec.ops.push(`move ${x} ${y}`),
      lineTo: (x: number, y: number) => rec.ops.push(`line ${x} ${y}`),
      stroke: () => rec.ops.push("stroke"),
      setLineDash: (seg: number[]) => rec.dashes.push(seg),
      set strokeStyle(s: string) {
        style = s;
        rec.styles.push(s);
      },
      get strokeStyle() {
        return style;
      },
    };
    const u: BoundarySurface = {
      valToPos: (v: number) => posOf.get(tsToDayLocal(v)) ?? -1,
      bbox: { top: 10, height: 200 },
      // biome-ignore lint/suspicious/noExplicitAny: test fake
      ctx: ctx as any,
    };
    void xs;
    return { u, rec };
  }

  test("draws one vertical line per boundary day inside the plot area", () => {
    const days = ["2026-01-05", "2026-01-09"];
    const { u, rec } = fakeSurface(days, []);
    drawBoundaryDays(u, days);
    // lines at x=100 and x=150, from top(10) to top+height(210)
    expect(rec.ops).toContain("move 100 10");
    expect(rec.ops).toContain("line 100 210");
    expect(rec.ops).toContain("move 150 10");
    expect(rec.ops).toContain("line 150 210");
    expect(rec.ops.filter((o) => o.startsWith("line")).length).toBe(2);
    expect(rec.ops).toContain("save");
    expect(rec.ops[rec.ops.length - 1]).toBe("restore");
    expect(rec.styles[0]).toBe("#3a4250");
  });

  test("no-op with zero boundaries (no ctx calls)", () => {
    const days: string[] = [];
    const { u, rec } = fakeSurface(days, []);
    drawBoundaryDays(u, days);
    expect(rec.ops).toHaveLength(0);
  });
});

describe("formatters", () => {
  test("valueFmt trims to at most 2 decimals", () => {
    expect(valueFmt(70)).toBe("70");
    expect(valueFmt(36.286111)).toBe("36.29");
    expect(valueFmt(6.5)).toBe("6.5");
  });

  test("dayToTs/tsToDay round-trip at UTC midnight", () => {
    expect(tsToDay(dayToTs("2026-11-07"))).toBe("2026-11-07");
  });
});
