import { describe, expect, test } from "bun:test";
import {
  boundary,
  boundarySpec,
  dedup,
  dedupSpec,
  general,
  generalSpec,
  MALFORMED_START,
  PHONE,
  SOURCE_A,
  SOURCE_B,
  SPIKE_ANCHOR,
  SPIKE_WINDOWS,
  spike,
  spikeSpec,
  UNKNOWN_TYPE,
  WATCH,
} from "./index";
import {
  addDays,
  assertWellFormed,
  buildFixture,
  inHrvNightWindow,
  KNOWN_TYPES,
  nightOf,
  parseExportDate,
  renderExport,
  SLEEP_VALUE,
  TYPE,
  wellFormedError,
} from "./model";

const ALL = [general, boundary, spike, dedup] as const;

describe("fixtures: XML validity", () => {
  test.each(ALL.map((f) => [f.name, f] as const))("%s renders well-formed XML", (_n, f) => {
    expect(() => assertWellFormed(f.xml)).not.toThrow();
    expect(f.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<HealthData')).toBe(true);
    expect(f.xml.trimEnd().endsWith("</HealthData>")).toBe(true);
  });

  test("well-formedness checker rejects broken documents", () => {
    expect(wellFormedError("<HealthData><Record/>")).toContain("unclosed");
    expect(wellFormedError("<a><b></a></b>")).toContain("mismatched");
    expect(wellFormedError('<a x="1" y=2/>')).toContain("bad attributes");
    expect(wellFormedError("<a>&</a>")).toContain("unescaped");
  });

  test("attribute values are XML-escaped", () => {
    const xml = renderExport({
      exportDate: "2026-01-01 00:00:00 +0900",
      records: [
        {
          type: TYPE.steps,
          sourceName: 'A & "B" <C>',
          startDate: "2026-01-01 00:00:00 +0900",
          endDate: "2026-01-01 00:00:00 +0900",
          value: "1",
        },
      ],
      workouts: [],
    });
    expect(xml).toContain('sourceName="A &amp; &quot;B&quot; &lt;C&gt;"');
    expect(() => assertWellFormed(xml)).not.toThrow();
  });

  test("rendering is deterministic", () => {
    expect(generalSpec()).toEqual(generalSpec());
    expect(renderExport(boundarySpec())).toBe(renderExport(boundarySpec()));
    expect(buildFixture("x", dedupSpec(), {}).xml).toBe(dedup.xml);
  });
});

describe("date handling", () => {
  test("parses offsets and converts to UTC", () => {
    const p = parseExportDate("2026-01-06 09:00:00 +0900");
    expect(p).toEqual({
      ok: true,
      utcIso: "2026-01-06T00:00:00.000Z",
      offsetMinutes: 540,
      localDay: "2026-01-06",
      localMinute: 540,
    });
    const n = parseExportDate("2026-01-05 16:15:00 -0500");
    expect(n.ok && n.utcIso).toBe("2026-01-05T21:15:00.000Z");
    expect(n.ok && n.localDay).toBe("2026-01-05");
  });

  test("local day stays the record's own day across offsets", () => {
    // 2026-01-06 06:15 +0900 and 2026-01-05 16:15 -0500 are the same instant but different local days.
    const a = parseExportDate("2026-01-06 06:15:00 +0900");
    const b = parseExportDate("2026-01-05 16:15:00 -0500");
    expect(a.ok && a.utcIso).toBe(b.ok ? b.utcIso : "");
    expect(a.ok && a.localDay).toBe("2026-01-06");
    expect(b.ok && b.localDay).toBe("2026-01-05");
  });

  test("rejects impossible calendar days and malformed strings", () => {
    expect(parseExportDate(MALFORMED_START)).toEqual({
      ok: false,
      reason: "invalid-calendar-date",
    });
    expect(parseExportDate("2026-02-28 24:00:00 +0900").ok).toBe(false);
    expect(parseExportDate("2026/01/06 09:00:00 +0900").ok).toBe(false);
    expect(parseExportDate("2026-01-06 09:00:00 +0960").ok).toBe(false);
  });

  test("night rule: >=15:00 same date, <09:00 previous date, 09:00-15:00 nap", () => {
    expect(nightOf("2026-01-10", 900)).toBe("2026-01-10");
    expect(nightOf("2026-01-10", 1439)).toBe("2026-01-10");
    expect(nightOf("2026-01-11", 0)).toBe("2026-01-10");
    expect(nightOf("2026-01-11", 539)).toBe("2026-01-10");
    expect(nightOf("2026-01-11", 540)).toBeNull();
    expect(nightOf("2026-01-10", 899)).toBeNull();
    expect(nightOf("2026-01-01", 0)).toBe("2025-12-31");
  });

  test("HRV window: 21:00 inclusive through 09:00 exclusive", () => {
    expect(inHrvNightWindow(20 * 60 + 59)).toBe(false);
    expect(inHrvNightWindow(21 * 60)).toBe(true);
    expect(inHrvNightWindow(8 * 60 + 59)).toBe(true);
    expect(inHrvNightWindow(9 * 60)).toBe(false);
  });

  test("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("general corpus", () => {
  const { expected } = general;
  const records = expected.records;

  test("is roughly 50 records with workouts and metadata", () => {
    expect(expected.recordCount).toBe(records.length);
    expect(records.length).toBeGreaterThanOrEqual(45);
    expect(records.length).toBeLessThanOrEqual(55);
    expect(expected.workoutCount).toBe(2);
    expect(expected.routeCount).toBe(1);
    expect(general.xml).toContain("<Workout ");
    expect(general.xml).toContain("<WorkoutRoute ");
    expect(general.xml).toContain('<FileReference path="/workout-routes/');
    expect(general.xml).toContain('<MetadataEntry key="HKMetadataKeySyncIdentifier"');
  });

  test("has at least two sources", () => {
    const sources = new Set(records.map((r) => r.sourceName));
    expect(sources.size).toBeGreaterThanOrEqual(2);
    expect(sources).toEqual(new Set([WATCH, PHONE, "Synthetic Sleep App"]));
  });

  test("covers +0900, +0100 and -0500 offsets", () => {
    const offsets = new Set(records.map((r) => r.offsetMinutes));
    expect(offsets.has(540)).toBe(true);
    expect(offsets.has(60)).toBe(true);
    expect(offsets.has(-300)).toBe(true);
  });

  test("contains all five sleep stage values", () => {
    const values = new Set(
      records.filter((r) => r.type === TYPE.sleep && r.value !== null).map((r) => r.value),
    );
    expect(values).toEqual(
      new Set([
        SLEEP_VALUE.inBed,
        SLEEP_VALUE.core,
        SLEEP_VALUE.deep,
        SLEEP_VALUE.rem,
        SLEEP_VALUE.awake,
      ]),
    );
  });

  test("sleep records split into nights and a daytime nap", () => {
    const nights = records.filter((r) => r.sleepSlot === "night");
    const naps = records.filter((r) => r.sleepSlot === "nap");
    expect(naps.map((r) => r.startDate)).toEqual(["2026-01-06 13:00:00 +0900"]);
    const byNight = new Map<string, number>();
    for (const r of nights) byNight.set(r.night ?? "", (byNight.get(r.night ?? "") ?? 0) + 1);
    expect(byNight.get("2026-01-05")).toBe(7);
    expect(byNight.get("2026-01-06")).toBe(5);
    expect(general.expected.facts.nightOf0105Stages).toBe(7);
  });

  test("night heart-rate samples fall between 01:00 and 06:00 local", () => {
    const night = records.filter(
      (r) =>
        r.type === TYPE.heartRate &&
        r.localDay === "2026-01-06" &&
        (r.localMinute ?? -1) >= 60 &&
        (r.localMinute ?? -1) <= 360,
    );
    expect(night.length).toBe(6);
    for (const r of night) expect(r.valueNumeric).not.toBeNull();
  });

  test("HRV is inside the night window for two samples and outside for one", () => {
    const hrv = records.filter((r) => r.type === TYPE.hrv);
    expect(hrv.map((r) => r.hrvNightWindow)).toEqual([true, true, false]);
  });

  test("unknown record type is present, flagged unknown, and not in the known set", () => {
    const unknown = records.filter((r) => r.type === UNKNOWN_TYPE);
    expect(unknown.length).toBe(1);
    expect(unknown[0]?.known).toBe(false);
    expect(KNOWN_TYPES.has(UNKNOWN_TYPE)).toBe(false);
    expect(general.xml).toContain(`type="${UNKNOWN_TYPE}"`);
  });

  test("malformed date is pinned, not silently repaired", () => {
    const bad = records.filter((r) => r.malformed !== null);
    expect(bad.length).toBe(1);
    expect(bad[0]?.startDate).toBe(MALFORMED_START);
    expect(bad[0]?.malformed).toBe("startDate:invalid-calendar-date");
    expect(bad[0]?.startUtc).toBeNull();
    expect(bad[0]?.offsetMinutes).toBeNull();
    expect(bad[0]?.localDay).toBeNull();
  });

  test("absent value attribute is recorded as null, not zero", () => {
    const noValue = records.filter((r) => r.value === null);
    expect(noValue.length).toBeGreaterThan(0);
    for (const r of noValue) expect(r.valueNumeric).toBeNull();
    expect(general.xml).not.toContain('value=""');
  });

  test("workouts carry the expected attributes", () => {
    expect(expected.workouts[0]).toMatchObject({
      activityType: "HKWorkoutActivityTypeRunning",
      sourceName: WATCH,
      durationMinutes: "32",
      routeFile: "/workout-routes/route_2026-01-06_7.00am.gpx",
    });
    expect(expected.workouts[1]?.routeFile).toBeNull();
  });

  test("snapshot locks XML shape and expectations", () => {
    expect(general.xml).toMatchSnapshot();
    expect(general.expected).toMatchSnapshot();
  });
});

describe("boundary corpus", () => {
  const byStart = (s: string) => {
    const r = boundary.expected.records.find((x) => x.startDate === s);
    if (!r) throw new Error(`no boundary record at ${s}`);
    return r;
  };

  test("14:59 is a nap and 15:00 starts that date's night", () => {
    expect(byStart("2026-01-10 14:59:00 +0900").sleepSlot).toBe("nap");
    const edge = byStart("2026-01-10 15:00:00 +0900");
    expect(edge.sleepSlot).toBe("night");
    expect(edge.night).toBe("2026-01-10");
  });

  test("08:59 belongs to the previous night and 09:00 is a nap", () => {
    const early = byStart("2026-01-11 08:59:00 +0900");
    expect(early.sleepSlot).toBe("night");
    expect(early.night).toBe("2026-01-10");
    expect(byStart("2026-01-11 09:00:00 +0900").sleepSlot).toBe("nap");
  });

  test("cross-midnight pair lands in one night", () => {
    const a = byStart("2026-01-12 23:55:00 +0900");
    const b = byStart("2026-01-13 00:05:00 +0900");
    expect(a.night).toBe("2026-01-12");
    expect(b.night).toBe("2026-01-12");
    expect(a.endUtc).not.toBe(b.endUtc);
    expect(boundary.expected.facts.nightOf0112).toBe(2);
  });

  test("offset edges are judged in the record's own offset", () => {
    expect(byStart("2026-01-14 14:59:00 +0100").sleepSlot).toBe("nap");
    const minus = byStart("2026-01-14 15:00:00 -0500");
    expect(minus.sleepSlot).toBe("night");
    expect(minus.night).toBe("2026-01-14");
  });

  test("HRV window edges: 20:59 out, 21:00 in, 08:59 in, 09:00 out", () => {
    expect(byStart("2026-01-12 20:59:00 +0900").hrvNightWindow).toBe(false);
    expect(byStart("2026-01-12 21:00:00 +0900").hrvNightWindow).toBe(true);
    expect(byStart("2026-01-13 08:59:00 +0900").hrvNightWindow).toBe(true);
    expect(byStart("2026-01-13 09:00:00 +0900").hrvNightWindow).toBe(false);
  });

  test("snapshot locks boundary shape", () => {
    expect(boundary.xml).toMatchSnapshot();
    expect(boundary.expected).toMatchSnapshot();
  });
});

describe("spike-regression corpus", () => {
  const { expected } = spike;
  const a = expected.records.filter((r) => r.sourceName === SOURCE_A);
  const b = expected.records.filter((r) => r.sourceName === SOURCE_B);

  test("uses the fixed anchor and the documented windows", () => {
    expect(SPIKE_ANCHOR).toBe("2026-03-01");
    expect(SPIKE_WINDOWS).toEqual({
      baselineStart: "2025-12-01", // anchor-90
      baselineEnd: "2026-01-31", // anchor-29
      recentStart: "2026-02-16", // anchor-13
      recentEnd: "2026-03-01", // anchor
    });
  });

  test("source A covers baseline inclusively, source B covers recent inclusively", () => {
    expect(a.map((r) => r.localDay)[0]).toBe("2025-12-01");
    expect(a.at(-1)?.localDay).toBe("2026-01-31");
    expect(a.length).toBe(62);
    expect(b.map((r) => r.localDay)[0]).toBe("2026-02-16");
    expect(b.at(-1)?.localDay).toBe("2026-03-01");
    expect(b.length).toBe(14);
  });

  test("baseline near 35.3 degC on A, recent near 36.3 degC on B", () => {
    for (const r of a) expect(Math.abs((r.valueNumeric ?? NaN) - 35.3)).toBeLessThanOrEqual(0.2);
    for (const r of b) expect(Math.abs((r.valueNumeric ?? NaN) - 36.3)).toBeLessThanOrEqual(0.2);
  });

  test("all records are wrist temperature in degC", () => {
    for (const r of expected.records) {
      expect(r.type).toBe(TYPE.wristTemp);
      expect(r.unit).toBe("degC");
      expect(r.malformed).toBeNull();
    }
  });

  test("values are deterministic across builds", () => {
    expect(spike.xml).toBe(buildFixture("spike", spikeSpec(), {}).xml);
  });

  test("snapshot locks spike shape", () => {
    expect(spike.expected.facts).toMatchSnapshot();
    expect(spike.xml).toMatchSnapshot();
  });
});

describe("dedup corpus", () => {
  const r = dedup.expected.records;

  test("byte-identical pair is flagged as an exact duplicate", () => {
    expect(r[1]?.exactDuplicateOf).toBe(0);
    expect(r[1]?.numericDuplicateOf).toBeNull();
    expect(r[0]?.exactDuplicateOf).toBeNull();
  });

  test("60 vs 60.0 on the same span is a numeric duplicate, not an exact one", () => {
    expect(r[2]?.value).toBe("60.0");
    expect(r[2]?.numericDuplicateOf).toBe(0);
    expect(r[2]?.exactDuplicateOf).toBeNull();
  });

  test("same numeric from a different source is not a duplicate", () => {
    expect(r[3]?.sourceName).not.toBe(r[0]?.sourceName);
    expect(r[3]?.exactDuplicateOf).toBeNull();
    expect(r[3]?.numericDuplicateOf).toBeNull();
  });

  test("no-value records are NULL, never numerically equal, and tie only exactly", () => {
    const noValue = r.filter((x) => x.value === null && x.type === TYPE.restingHeartRate);
    expect(noValue.length).toBe(3);
    for (const x of noValue) expect(x.valueNumeric).toBeNull();
    expect(r[4]?.value).toBeNull();
    expect(r[5]?.value).toBe("56");
    expect(r[5]?.numericDuplicateOf).toBeNull();
    expect(r[7]?.exactDuplicateOf).toBe(6);
  });

  test("category records compare raw, never numerically", () => {
    expect(r[9]?.exactDuplicateOf).toBe(8);
    expect(r[10]?.value).toBe(SLEEP_VALUE.deep);
    expect(r[10]?.exactDuplicateOf).toBeNull();
    expect(r[10]?.numericDuplicateOf).toBeNull();
    expect(r[10]?.category).toBe(true);
    expect(r[10]?.valueNumeric).toBeNull();
    expect(r[11]?.value).toBeNull();
  });

  test("60.00 vs 60 on the same span collapses numerically", () => {
    expect(r[13]?.valueNumeric).toBe(60);
    expect(r[14]?.numericDuplicateOf).toBe(13);
  });

  test("snapshot locks dedup shape", () => {
    expect(dedup.xml).toMatchSnapshot();
    expect(dedup.expected).toMatchSnapshot();
  });
});

describe("corpus isolation", () => {
  test("no fixture emits a real-looking absolute path or a reserved personal file name", () => {
    for (const f of ALL) {
      expect(f.xml).not.toMatch(/\/home\//);
      expect(f.xml).not.toMatch(/\.zip|\.db/);
    }
  });

  test("all fixture sources are synthetic labels", () => {
    for (const f of ALL) {
      for (const rec of f.expected.records) expect(rec.sourceName).toMatch(/^Synthetic /);
    }
  });
});
