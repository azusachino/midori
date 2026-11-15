/**
 * Shared model for synthetic Apple Health export fixtures.
 *
 * Every fixture is built from a plain `ExportSpec` and yields two things:
 *   - `xml`: a HealthKit Export Version 17 shaped `export.xml` string
 *   - `expected`: per-record parsed expectations a parser test can assert against
 *
 * Pure and deterministic: no Date.now, no randomness without a fixed seed, no I/O.
 * Synthetic data only. Names and values are invented.
 */

export const TYPE = {
  heartRate: "HKQuantityTypeIdentifierHeartRate",
  restingHeartRate: "HKQuantityTypeIdentifierRestingHeartRate",
  hrv: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  steps: "HKQuantityTypeIdentifierStepCount",
  activeEnergy: "HKQuantityTypeIdentifierActiveEnergyBurned",
  spo2: "HKQuantityTypeIdentifierOxygenSaturation",
  respiratoryRate: "HKQuantityTypeIdentifierRespiratoryRate",
  wristTemp: "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
} as const;

export const SLEEP_VALUE = {
  inBed: "HKCategoryValueSleepAnalysisInBed",
  core: "HKCategoryValueSleepAnalysisAsleepCore",
  deep: "HKCategoryValueSleepAnalysisAsleepDeep",
  rem: "HKCategoryValueSleepAnalysisAsleepREM",
  awake: "HKCategoryValueSleepAnalysisAwake",
} as const;

/** Types the midori mapper knows about. Anything else is an "unknown" record type. */
export const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(Object.values(TYPE));

/** Sleep-stage starts at or after this local minute (15:00) belong to that date's night. */
export const NIGHT_START_MINUTE = 15 * 60;
/** Sleep-stage starts before this local minute (09:00) belong to the previous date's night. */
export const NIGHT_END_MINUTE = 9 * 60;
/** HRV samples count only inside the nighttime window: 21:00 (inclusive) to 09:00 (exclusive). */
export const HRV_WINDOW_START_MINUTE = 21 * 60;

export type RecordSpec = {
  type: string;
  sourceName: string;
  unit?: string;
  startDate: string;
  endDate: string;
  /** Raw value attribute. Omitted entirely when undefined. */
  value?: string;
  /** Raw HealthKit device attribute. Omitted when the record has no device. */
  device?: string;
  metadata?: Readonly<Record<string, string>>;
};

export type WorkoutSpec = {
  activityType: string;
  sourceName: string;
  durationMinutes: string;
  startDate: string;
  endDate: string;
  metadata?: Readonly<Record<string, string>>;
  /** When set, a WorkoutRoute element with a FileReference to this path is emitted. */
  routePath?: string;
};

export type ExportSpec = {
  exportDate: string;
  records: readonly RecordSpec[];
  workouts: readonly WorkoutSpec[];
};

export type SleepSlot = "night" | "nap" | "not-sleep" | "malformed";

export type ExpectedRecord = {
  /** Index among <Record> elements in document order (0-based). */
  ordinal: number;
  type: string;
  known: boolean;
  category: boolean;
  sourceName: string;
  unit: string | null;
  /** Raw value attribute as written, null when the attribute is absent. */
  value: string | null;
  /** Numeric reading of a quantity value, null for categories, absent values, or non-numeric text. */
  valueNumeric: number | null;
  startDate: string;
  endDate: string;
  /** UTC instant as ISO-8601, null when the date is malformed. */
  startUtc: string | null;
  endUtc: string | null;
  /** Export offset in minutes east of UTC (+0900 = 540), null when malformed. */
  offsetMinutes: number | null;
  /** Calendar day in the record's own offset, derived from startDate. */
  localDay: string | null;
  /** Minute of day (0..1439) of startDate in the record's own offset. */
  localMinute: number | null;
  sleepSlot: SleepSlot;
  /** Night date per the night rule, for sleep records assigned to a night; otherwise null. */
  night: string | null;
  /** HRV only: true when the start falls in the 21:00-09:00 window. Null for other types. */
  hrvNightWindow: boolean | null;
  metadata: Readonly<Record<string, string>>;
  device: string | null;
  /** Reason the record's dates are malformed, or null. */
  malformed: string | null;
  /** Ordinal of the first earlier record that is byte-identical to this one, else null. */
  exactDuplicateOf: number | null;
  /** Ordinal of the first earlier record with the same type/source/UTC span and equal numeric value
   *  but a different raw string (e.g. "60" vs "60.0"), else null. */
  numericDuplicateOf: number | null;
};

export type ExpectedWorkout = {
  activityType: string;
  sourceName: string;
  durationMinutes: string;
  startDate: string;
  endDate: string;
  metadata: Readonly<Record<string, string>>;
  routeFile: string | null;
};

export type Facts = Readonly<Record<string, string | number>>;

export type ExpectedExport = {
  exportDate: string;
  recordCount: number;
  workoutCount: number;
  routeCount: number;
  records: ExpectedRecord[];
  workouts: ExpectedWorkout[];
  /** Corpus-level facts a test can pin (windows, anchors, counts by category). */
  facts: Facts;
};

export type Fixture = {
  name: string;
  xml: string;
  expected: ExpectedExport;
};

// ---------------------------------------------------------------------------
// Dates

export type ParsedDate =
  | {
      ok: true;
      utcIso: string;
      offsetMinutes: number;
      localDay: string;
      localMinute: number;
    }
  | { ok: false; reason: string };

const EXPORT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

/** Parses HealthKit export dates: `YYYY-MM-DD HH:MM:SS +ZZZZ`. */
export function parseExportDate(raw: string): ParsedDate {
  const m = EXPORT_DATE_RE.exec(raw);
  if (!m) return { ok: false, reason: "unparseable" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const sign = m[7] === "-" ? -1 : 1;
  const offsetHours = Number(m[8]);
  const offsetMins = Number(m[9]);
  if (offsetMins >= 60 || offsetHours > 14) return { ok: false, reason: "unparseable" };

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(localAsUtc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { ok: false, reason: "invalid-calendar-date" };
  }

  const offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  const utcMs = localAsUtc - offsetMinutes * 60_000;
  return {
    ok: true,
    utcIso: new Date(utcMs).toISOString(),
    offsetMinutes,
    localDay: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    localMinute: hour * 60 + minute,
  };
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Night rule: >=15:00 -> same date, <09:00 -> previous date, otherwise a nap (null). */
export function nightOf(localDay: string, localMinute: number): string | null {
  if (localMinute >= NIGHT_START_MINUTE) return localDay;
  if (localMinute < NIGHT_END_MINUTE) return addDays(localDay, -1);
  return null;
}

/** HRV nighttime window: 21:00 inclusive through 09:00 exclusive. */
export function inHrvNightWindow(localMinute: number): boolean {
  return localMinute >= HRV_WINDOW_START_MINUTE || localMinute < NIGHT_END_MINUTE;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Formats a local wall-clock time as an export date string. */
export function exportDate(
  ymd: string,
  hhmm: string,
  offset: "+0900" | "+0100" | "-0500" | (string & {}),
): string {
  return `${ymd} ${hhmm}:00 ${offset}`;
}

// ---------------------------------------------------------------------------
// Deterministic randomness

/** mulberry32: small seeded PRNG returning floats in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// XML rendering

export function escapeXml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function attrs(pairs: ReadonlyArray<readonly [string, string | undefined]>): string {
  return pairs.flatMap(([k, v]) => (v === undefined ? [] : [` ${k}="${escapeXml(v)}"`])).join("");
}

function metadataLines(metadata: Readonly<Record<string, string>> | undefined, indent: string) {
  return Object.entries(metadata ?? {}).map(
    ([k, v]) => `${indent}<MetadataEntry key="${escapeXml(k)}" value="${escapeXml(v)}"/>`,
  );
}

function renderRecord(r: RecordSpec): string[] {
  const open = `  <Record${attrs([
    ["type", r.type],
    ["sourceName", r.sourceName],
    ["unit", r.unit],
    ["startDate", r.startDate],
    ["endDate", r.endDate],
    ["value", r.value],
    ["device", r.device],
  ])}`;
  const children = metadataLines(r.metadata, "    ");
  if (children.length === 0) return [`${open}/>`];
  return [`${open}>`, ...children, "  </Record>"];
}

function renderWorkout(w: WorkoutSpec): string[] {
  const open = `  <Workout${attrs([
    ["workoutActivityType", w.activityType],
    ["duration", w.durationMinutes],
    ["durationUnit", "min"],
    ["sourceName", w.sourceName],
    ["startDate", w.startDate],
    ["endDate", w.endDate],
  ])}`;
  const children = metadataLines(w.metadata, "    ");
  if (w.routePath !== undefined) {
    children.push(
      `    <WorkoutRoute${attrs([
        ["sourceName", w.sourceName],
        ["startDate", w.startDate],
        ["endDate", w.endDate],
      ])}>`,
      `      <FileReference path="${escapeXml(w.routePath)}"/>`,
      "    </WorkoutRoute>",
    );
  }
  if (children.length === 0) return [`${open}/>`];
  return [`${open}>`, ...children, "  </Workout>"];
}

export function renderExport(spec: ExportSpec): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<HealthData locale="en_US">',
    `  <ExportDate value="${escapeXml(spec.exportDate)}"/>`,
    ...spec.records.flatMap(renderRecord),
    ...spec.workouts.flatMap(renderWorkout),
    "</HealthData>",
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Expectations

function numericOf(value: string | null, category: boolean): number | null {
  if (value === null || category || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function expectRecord(r: RecordSpec, ordinal: number): ExpectedRecord {
  const start = parseExportDate(r.startDate);
  const end = parseExportDate(r.endDate);
  const category = r.type.startsWith("HKCategoryTypeIdentifier");
  const value = r.value ?? null;
  const malformed = !start.ok
    ? `startDate:${start.reason}`
    : !end.ok
      ? `endDate:${end.reason}`
      : null;

  let sleepSlot: SleepSlot = "not-sleep";
  let night: string | null = null;
  if (r.type === TYPE.sleep) {
    if (!start.ok) {
      sleepSlot = "malformed";
    } else {
      night = nightOf(start.localDay, start.localMinute);
      sleepSlot = night === null ? "nap" : "night";
    }
  }

  let hrvNightWindow: boolean | null = null;
  if (r.type === TYPE.hrv) {
    hrvNightWindow = start.ok ? inHrvNightWindow(start.localMinute) : false;
  }

  return {
    ordinal,
    type: r.type,
    known: KNOWN_TYPES.has(r.type) || category,
    category,
    sourceName: r.sourceName,
    unit: r.unit ?? null,
    value,
    valueNumeric: numericOf(value, category),
    startDate: r.startDate,
    endDate: r.endDate,
    startUtc: start.ok ? start.utcIso : null,
    endUtc: end.ok ? end.utcIso : null,
    offsetMinutes: start.ok ? start.offsetMinutes : null,
    localDay: start.ok ? start.localDay : null,
    localMinute: start.ok ? start.localMinute : null,
    sleepSlot,
    night,
    hrvNightWindow,
    metadata: { ...(r.metadata ?? {}) },
    device: r.device ?? null,
    malformed,
    exactDuplicateOf: null,
    numericDuplicateOf: null,
  };
}

/** Computes duplicate relations generically from the spec, so corpora need no hand annotation. */
function markDuplicates(records: ExpectedRecord[], specs: readonly RecordSpec[]): void {
  const rawKey = (r: RecordSpec) =>
    JSON.stringify([
      r.type,
      r.sourceName,
      r.unit,
      r.startDate,
      r.endDate,
      r.value,
      r.device,
      r.metadata,
    ]);
  const spanKey = (e: ExpectedRecord) => `${e.type}|${e.sourceName}|${e.startUtc}|${e.endUtc}`;
  for (const [i, rec] of records.entries()) {
    const spec = specs[i];
    if (spec === undefined) continue;
    const earlier = records.slice(0, i);
    const exact = earlier.find((_, j) => {
      const other = specs[j];
      return other !== undefined && rawKey(other) === rawKey(spec);
    });
    rec.exactDuplicateOf = exact?.ordinal ?? null;
    if (exact === undefined && rec.valueNumeric !== null && rec.startUtc !== null) {
      const numeric = earlier.find(
        (e) => e.valueNumeric === rec.valueNumeric && spanKey(e) === spanKey(rec),
      );
      rec.numericDuplicateOf = numeric?.ordinal ?? null;
    }
  }
}

export function expectExport(spec: ExportSpec, facts: Facts): ExpectedExport {
  const records = spec.records.map((r, i) => expectRecord(r, i));
  markDuplicates(records, spec.records);
  const workouts: ExpectedWorkout[] = spec.workouts.map((w) => ({
    activityType: w.activityType,
    sourceName: w.sourceName,
    durationMinutes: w.durationMinutes,
    startDate: w.startDate,
    endDate: w.endDate,
    metadata: { ...(w.metadata ?? {}) },
    routeFile: w.routePath ?? null,
  }));
  return {
    exportDate: spec.exportDate,
    recordCount: records.length,
    workoutCount: workouts.length,
    routeCount: workouts.filter((w) => w.routeFile !== null).length,
    records,
    workouts,
    facts,
  };
}

export function buildFixture(name: string, spec: ExportSpec, facts: Facts): Fixture {
  return { name, xml: renderExport(spec), expected: expectExport(spec, facts) };
}

// ---------------------------------------------------------------------------
// Well-formedness check (no XML dependency; covers what the fixtures produce)

const ENTITY_OK = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/;

/** Returns null when the document is well-formed for the subset the fixtures emit, else a reason. */
export function wellFormedError(xml: string): string | null {
  const body = xml.replace(/^<\?xml[^>]*\?>\n?/, "");
  if (body.includes("<!--") || body.includes("<!DOCTYPE")) return "unexpected comment or doctype";
  const text = body.replace(/<[^<>]*>/g, "");
  if (text.includes("<")) return "stray '<' in text";
  const badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.exec(body);
  if (badAmp) return `unescaped '&' at offset ${badAmp.index}`;
  if (!ENTITY_OK.test(body) && body.includes("&")) return "entity without escape";

  const stack: string[] = [];
  for (const m of body.matchAll(/<([^<>]*)>/g)) {
    const inner = m[1] ?? "";
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      if (stack.pop() !== name) return `mismatched close </${name}>`;
      continue;
    }
    const selfClosing = inner.endsWith("/");
    const decl = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(decl);
    if (!nameMatch) return `bad tag <${inner}>`;
    const name = nameMatch[0];
    const rest = decl.slice(name.length);
    if (!/^(\s+[A-Za-z_][\w.:-]*="[^"]*")*\s*$/.test(rest)) return `bad attributes in <${inner}>`;
    if (!selfClosing) stack.push(name);
  }
  if (stack.length > 0) return `unclosed <${stack.join(">, <")}>`;
  return null;
}

export function assertWellFormed(xml: string): void {
  const err = wellFormedError(xml);
  if (err !== null) throw new Error(`fixture XML not well-formed: ${err}`);
}
