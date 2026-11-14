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

/** Adds n days to a 'YYYY-MM-DD' string (UTC arithmetic, format-level operation). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
