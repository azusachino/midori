/**
 * HealthKit export date parsing ('YYYY-MM-DD HH:MM:SS ±ZZZZ').
 * Production twin of the fixture model's parser; parser tests cross-check the
 * two implementations against each other.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

export interface ParsedDate {
  utcIso: string;
  offsetMinutes: number;
  localDay: string;
  localMinute: number;
}

export type DateParse = { ok: true; date: ParsedDate } | { ok: false; reason: string };

export function parseHealthKitDate(raw: string): DateParse {
  const m = DATE_RE.exec(raw);
  if (!m) return { ok: false, reason: "unparseable" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const offsetHours = Number(m[8]);
  const offsetMins = Number(m[9]);

  if (offsetMins >= 60 || offsetHours > 14) return { ok: false, reason: "bad-offset" };
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: "invalid-calendar-date" };
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(localAsUtc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, reason: "invalid-calendar-date" };
  }

  const sign = m[7] === "-" ? -1 : 1;
  const offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  const utcMs = localAsUtc - offsetMinutes * 60_000;
  return {
    ok: true,
    date: {
      utcIso: new Date(utcMs).toISOString(),
      offsetMinutes,
      localDay: `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      localMinute: hour * 60 + minute,
    },
  };
}

/** Calendar day and minute in the selected zone. */
export interface ZonedDateTime {
  localDay: string;
  localMinute: number;
}

/** Gets the wall-clock day and minute for an instant in an IANA timezone. */
export function instantInZone(utcIso: string, timeZone: string): ZonedDateTime {
  const fixedOffset = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timeZone);
  if (fixedOffset) {
    const offset =
      (fixedOffset[1] === "-" ? -1 : 1) * (Number(fixedOffset[2]) * 60 + Number(fixedOffset[3]));
    return utcToLocal(utcIso, offset);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcIso));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    localDay: `${values.year}-${values.month}-${values.day}`,
    localMinute: Number(values.hour) * 60 + Number(values.minute),
  };
}

/** Converts a local wall-clock time to an instant using the zone's offset at that time. */
export function zoneLocalToUtc(ymd: string, minute: number, timeZone: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  const fixedOffset = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timeZone);
  if (fixedOffset) {
    const offset =
      (fixedOffset[1] === "-" ? -1 : 1) * (Number(fixedOffset[2]) * 60 + Number(fixedOffset[3]));
    return (
      Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, Math.floor(minute / 60), minute % 60) -
      offset * 60_000
    );
  }
  const guess = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    Math.floor(minute / 60),
    minute % 60,
  );
  const local = instantInZone(new Date(guess).toISOString(), timeZone);
  const localGuess = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    Math.floor(minute / 60),
    minute % 60,
  );
  const observedLocal = Date.UTC(
    Number(local.localDay.slice(0, 4)),
    Number(local.localDay.slice(5, 7)) - 1,
    Number(local.localDay.slice(8, 10)),
    Math.floor(local.localMinute / 60),
    local.localMinute % 60,
  );
  return guess + (localGuess - observedLocal);
}

/** Adds n days to a 'YYYY-MM-DD' string (UTC arithmetic, format-level operation). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Inverse of parseHealthKitDate for stored rows: UTC instant + stored offset ->
 * record-local calendar day and minute-of-day. Used when reading records back
 * from the store (the XML timestamp itself is long gone by then).
 */
export function utcToLocal(
  utcIso: string,
  offsetMinutes: number,
): { localDay: string; localMinute: number } {
  const shifted = new Date(new Date(utcIso).getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    localDay: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    localMinute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}
