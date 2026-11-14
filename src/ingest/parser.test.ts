import { describe, expect, test } from "bun:test";
import { boundary, dedup, type Fixture, general, spike } from "../../tests/fixtures";
import { MALFORMED_START, UNKNOWN_TYPE, WATCH } from "../../tests/fixtures/general";
import { SOURCE_A, SOURCE_B, SPIKE_ANCHOR, SPIKE_WINDOWS } from "../../tests/fixtures/spike";
import { buildStoredZip } from "../../tests/util/mkzip";
import { addDays } from "../domain/dates";
import { type MapResult, mapRecord } from "./mapper";
import { parseExportXml, type XmlParseStats } from "./parser";
import { openExportXml } from "./zip";

async function* chunksOf(s: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}

interface RunOutcome {
  stats: XmlParseStats;
  mapped: MapResult[];
}

async function run(xml: string, chunkSize = 1 << 16): Promise<RunOutcome> {
  const mapped: MapResult[] = [];
  const stats = await parseExportXml(chunksOf(xml, chunkSize), {
    onRecord: (row) => {
      mapped.push(mapRecord(row));
    },
  });
  return { stats, mapped };
}

describe("parser: general corpus", () => {
  const fx: Fixture = general;
  let outcome: RunOutcome;
  const runOnce = async () => (outcome ??= await run(fx.xml));

  test("record count and presence match expectations", async () => {
    const { stats } = await runOnce();
    expect(stats.recordCount).toBe(fx.expected.recordCount);
    expect(stats.presence.Record).toBe(fx.expected.recordCount);
    expect(stats.presence.Workout).toBe(fx.expected.workoutCount);
    expect(stats.presence.WorkoutRoute ?? 0).toBe(fx.expected.routeCount);
    expect(stats.presence.FileReference ?? 0).toBe(fx.expected.routeCount);
    expect((stats.presence.MetadataEntry ?? 0) > 0).toBe(true);
  });

  test("ExportDate element value is captured", async () => {
    const { stats } = await runOnce();
    expect(stats.exportDate).toBe(fx.expected.exportDate);
  });

  test("every well-formed record maps to the expected row", async () => {
    const { mapped } = await runOnce();
    const exps = fx.expected.records;
    expect(mapped.length).toBe(exps.length);
    for (const [i, result] of mapped.entries()) {
      const exp = exps[i];
      if (exp === undefined) throw new Error(`missing expectation ${i}`);
      if (exp.malformed !== null) {
        expect(result.ok).toBe(false);
        continue;
      }
      if (
        exp.startUtc === null ||
        exp.endUtc === null ||
        exp.offsetMinutes === null ||
        exp.localDay === null
      ) {
        throw new Error("fixture invariant: non-malformed expectation has null dates");
      }
      if (!result.ok) throw new Error(`record ${i} failed to map: ${result.reason}`);
      expect(result.record.row.type).toBe(exp.type);
      expect(result.record.row.sourceName).toBe(exp.sourceName);
      expect(result.record.row.unit).toBe(exp.unit);
      expect(result.record.row.startAt).toBe(exp.startUtc);
      expect(result.record.row.endAt).toBe(exp.endUtc);
      expect(result.record.row.startOffsetMin).toBe(exp.offsetMinutes);
      expect(result.record.row.value).toBe(exp.valueNumeric);
      expect(result.record.row.valueStr ?? null).toBe(exp.category ? exp.value : null);
      if (exp.category) expect(result.record.row.value).toBeNull();
      expect(result.record.localDay).toBe(exp.localDay);
    }
  });

  test("malformed date is counted and pinned, never silently repaired", async () => {
    const { mapped } = await runOnce();
    const bad = mapped.filter((m) => !m.ok);
    expect(bad).toHaveLength(1);
    const b0 = bad[0];
    expect(b0?.ok === false && b0.raw.startDate === MALFORMED_START).toBe(true);
    expect(fx.expected.records.some((r) => r.malformed !== null)).toBe(true);
  });

  test("unknown type is stored with a null metric key, not dropped", async () => {
    const { mapped } = await runOnce();
    const rows = mapped.flatMap((m) => (m.ok ? [m.record] : []));
    const unknown = rows.find((r) => r.row.type === UNKNOWN_TYPE);
    expect(unknown).toBeDefined();
    expect(unknown?.metricKey).toBeNull();
  });

  test("known types map to registry metric keys", async () => {
    const { mapped } = await runOnce();
    const hr = mapped
      .flatMap((m) => (m.ok ? [m.record] : []))
      .find((r) => r.row.type.includes("HeartRate"));
    expect(hr?.metricKey).toBe("heart_rate");
  });

  test("chunk size does not change the result (stream safety)", async () => {
    const whole = await run(fx.xml, fx.xml.length);
    const tiny = await run(fx.xml, 7);
    expect(tiny.stats.recordCount).toBe(whole.stats.recordCount);
    expect(tiny.mapped.length).toBe(whole.mapped.length);
    expect(tiny.mapped.every((m, i) => JSON.stringify(m) === JSON.stringify(whole.mapped[i]))).toBe(
      true,
    );
  });
});

describe("parser: boundary corpus", () => {
  const fx: Fixture = boundary;

  test("all records map; local days and minutes follow the record's own offset", async () => {
    const { stats, mapped } = await run(fx.xml);
    expect(stats.recordCount).toBe(fx.expected.recordCount);
    for (const [i, result] of mapped.entries()) {
      const exp = fx.expected.records[i];
      expect(exp).toBeDefined();
      if (!result.ok || exp === undefined) continue;
      if (exp.localDay === null || exp.offsetMinutes === null) {
        throw new Error("boundary fixture: well-formed record with null day/offset");
      }
      expect(result.record.localDay).toBe(exp.localDay);
      expect(result.record.row.startOffsetMin).toBe(exp.offsetMinutes);
    }
  });
});

describe("parser: dedup corpus", () => {
  const fx: Fixture = dedup;

  test("60 and 60.0 collapse to the same numeric; raw text preserved for categories", async () => {
    const { mapped } = await run(fx.xml);
    const rows = mapped.flatMap((m) => (m.ok ? [m.record] : []));
    const numericPair = rows.filter((r) => r.row.value === 60);
    expect(numericPair.length).toBeGreaterThanOrEqual(2);
    const category = rows.find((r) => r.row.valueStr !== null);
    expect(category?.row.value).toBeNull();
    const absent = rows.find((r) => r.row.value === null && r.row.valueStr === null);
    expect(absent).toBeDefined();
  });
});

describe("parser: spike corpus", () => {
  const fx: Fixture = spike;

  test("two sources with exact window coverage map as wrist_temp", async () => {
    const { mapped } = await run(fx.xml);
    const rows = mapped.flatMap((m) => (m.ok ? [m.record] : []));
    expect(rows.every((r) => r.metricKey === "wrist_temp")).toBe(true);

    const a = rows.filter((r) => r.row.sourceName === SOURCE_A).map((r) => r.localDay);
    const b = rows.filter((r) => r.row.sourceName === SOURCE_B).map((r) => r.localDay);
    const baselineStart = SPIKE_WINDOWS.baselineStart;
    const baselineEnd = SPIKE_WINDOWS.baselineEnd;
    const recentStart = SPIKE_WINDOWS.recentStart;
    expect(a.some((d) => d === baselineStart)).toBe(true);
    expect(a.some((d) => d === addDays(SPIKE_ANCHOR, -90))).toBe(true);
    expect(a.some((d) => d === baselineEnd)).toBe(true);
    expect(a.every((d) => d <= baselineEnd)).toBe(true);
    expect(b.some((d) => d === recentStart)).toBe(true);
    expect(b.some((d) => d === SPIKE_ANCHOR)).toBe(true);
    expect(b.every((d) => d >= recentStart)).toBe(true);
    expect(SOURCE_A).not.toBe(SOURCE_B);
    expect(WATCH.length).toBeGreaterThan(0);
  });
});

describe("zip: export.xml discovery and streaming", () => {
  const fx: Fixture = general;

  async function withZip(
    entries: { name: string; data: string }[],
    fn: (path: string) => Promise<void>,
  ) {
    const dir = import.meta.dir;
    const path = `${dir}/../../.tmp-zip-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`;
    await Bun.write(path, buildStoredZip(entries));
    try {
      await fn(path);
    } finally {
      await Bun.file(path).delete();
    }
  }

  test("selects apple_health_export/export.xml, skips export_cda.xml, streams identical rows", async () => {
    await withZip(
      [
        { name: "apple_health_export/export_cda.xml", data: "<ClinicalDocument/>" },
        { name: "apple_health_export/workout-routes/route1.gpx", data: "<gpx/>" },
        { name: "apple_health_export/export.xml", data: fx.xml },
      ],
      async (path) => {
        const handle = await openExportXml(path);
        expect(handle.entryName).toBe("apple_health_export/export.xml");
        expect(handle.totalEntries).toBe(3);
        const mapped: MapResult[] = [];
        const stats = await parseExportXml(handle.chunks, {
          onRecord: (row) => {
            mapped.push(mapRecord(row));
          },
        });
        expect(stats.recordCount).toBe(fx.expected.recordCount);
        expect(mapped.length).toBe(fx.expected.recordCount);
      },
    );
  });

  test("archive without export.xml is a hard error", async () => {
    await withZip(
      [
        { name: "apple_health_export/export_cda.xml", data: "<ClinicalDocument/>" },
        { name: "readme.txt", data: "no xml here" },
      ],
      async (path) => {
        expect(openExportXml(path)).rejects.toThrow(/no export\.xml/);
      },
    );
  });
});
