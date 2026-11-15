import { type RecordSpec, renderExport, SLEEP_VALUE, TYPE } from "../../tests/fixtures";

export const E2E_CORPUS_EXPORT_DATE = "2026-11-15 14:00:00 +0900";
export const E2E_AS_OF_DAY = "2026-11-14";

const WATCH_A_SOURCE = "Synthetic Watch A";
const WATCH_B_SOURCE = "Synthetic Watch B";
const PHONE_SOURCE = "Synthetic iPhone";
const APP_SOURCE = "Sleep Tracker App";

const VO2_MAX_TYPE = "HKQuantityTypeIdentifierVO2Max";

function deviceAttr(name: string, hardware: string, software: string, model: string): string {
  return `<<HKDevice: e2e>, name:${name}, hardware:${hardware}, software:${software}, model:${model}>`;
}

const WATCH_A_10_4 = deviceAttr(WATCH_A_SOURCE, "Watch6,1", "10.4", "Watch");
const WATCH_A_10_5 = deviceAttr(WATCH_A_SOURCE, "Watch6,1", "10.5", "Watch");
const WATCH_B_11_0 = deviceAttr(WATCH_B_SOURCE, "Watch7,5", "11.0", "Watch");
const WATCH_B_11_1 = deviceAttr(WATCH_B_SOURCE, "Watch7,5", "11.1", "Watch");
const WATCH_B_11_2 = deviceAttr(WATCH_B_SOURCE, "Watch7,5", "11.2", "Watch");
const PHONE_DEVICE = deviceAttr(PHONE_SOURCE, "iPhone16,1", "18.1", "iPhone");

function addIsoDays(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  let cur = startDay;
  while (cur <= endDay) {
    out.push(cur);
    cur = addIsoDays(cur, 1);
  }
  return out;
}

function pseudoNoise(index: number, period: number, amplitude: number): number {
  return Math.sin((index * 2 * Math.PI) / period) * amplitude;
}

function watchASwForDay(day: string): string {
  return day >= "2026-09-20" ? WATCH_A_10_5 : WATCH_A_10_4;
}

function watchBSwForDay(day: string): string {
  if (day >= "2026-11-09") return WATCH_B_11_2;
  if (day >= "2026-10-25") return WATCH_B_11_1;
  return WATCH_B_11_0;
}

function pushNightSleep(
  records: RecordSpec[],
  nightDay: string,
  sourceName: string,
  device: string | undefined,
  tzName: string,
  offsetStr: string,
): void {
  const wakeDay = addIsoDays(nightDay, 1);
  const meta = { HKTimeZone: tzName };
  // 4.5h core + 1.5h deep + 1.5h REM = 7.5h asleep ending 06:30 next morning
  const stages: Array<{ start: string; end: string; value: string }> = [
    {
      start: `${nightDay} 23:00:00 ${offsetStr}`,
      end: `${wakeDay} 03:30:00 ${offsetStr}`,
      value: SLEEP_VALUE.core,
    },
    {
      start: `${wakeDay} 03:30:00 ${offsetStr}`,
      end: `${wakeDay} 05:00:00 ${offsetStr}`,
      value: SLEEP_VALUE.deep,
    },
    {
      start: `${wakeDay} 05:00:00 ${offsetStr}`,
      end: `${wakeDay} 06:30:00 ${offsetStr}`,
      value: SLEEP_VALUE.rem,
    },
  ];
  for (const s of stages) {
    records.push({
      type: TYPE.sleep,
      sourceName,
      startDate: s.start,
      endDate: s.end,
      value: s.value,
      metadata: meta,
      ...(device ? { device } : {}),
    });
  }
}

function pushNightVitals(
  records: RecordSpec[],
  nightDay: string,
  idx: number,
  sourceName: string,
  device: string,
  offsetStr: string,
  opts: {
    hrvBase: number;
    hrvSamples?: number;
    rhrVal: number;
    respVal: number;
    tempVal?: number;
    spo2Val?: number;
  },
): void {
  const wakeDay = addIsoDays(nightDay, 1);
  const hrvCount = opts.hrvSamples ?? 3;
  const hrvHours = ["01:00:00", "02:30:00", "04:00:00", "05:30:00"];
  for (let i = 0; i < hrvCount; i++) {
    const ts = `${wakeDay} ${hrvHours[i % hrvHours.length]} ${offsetStr}`;
    const v = opts.hrvBase + (i - 1) * 1.1;
    records.push({
      type: TYPE.hrv,
      sourceName,
      unit: "ms",
      startDate: ts,
      endDate: ts,
      value: v.toFixed(1),
      device,
    });
  }

  const rhrTs = `${wakeDay} 06:15:00 ${offsetStr}`;
  records.push({
    type: TYPE.restingHeartRate,
    sourceName,
    unit: "count/min",
    startDate: rhrTs,
    endDate: rhrTs,
    value: opts.rhrVal.toFixed(1),
    device,
  });

  const respHours = ["01:30:00", "03:00:00", "04:30:00"];
  for (const h of respHours) {
    const ts = `${wakeDay} ${h} ${offsetStr}`;
    records.push({
      type: TYPE.respiratoryRate,
      sourceName,
      unit: "count/min",
      startDate: ts,
      endDate: ts,
      value: opts.respVal.toFixed(1),
      device,
    });
  }

  if (opts.tempVal !== undefined) {
    const tempTs = `${wakeDay} 05:45:00 ${offsetStr}`;
    records.push({
      type: TYPE.wristTemp,
      sourceName,
      unit: "degC",
      startDate: tempTs,
      endDate: tempTs,
      value: opts.tempVal.toFixed(2),
      device,
    });
  }

  if (opts.spo2Val !== undefined) {
    for (const h of ["01:20:00", "03:20:00", "05:20:00"]) {
      const ts = `${wakeDay} ${h} ${offsetStr}`;
      records.push({
        type: TYPE.spo2,
        sourceName,
        unit: "%",
        startDate: ts,
        endDate: ts,
        value: opts.spo2Val.toFixed(1),
        device,
      });
    }
  }

  // Keep idx referenced deterministically for minor vitals jitter if needed
  void idx;
}

export function buildE2eCorpusXml(): string {
  const records: RecordSpec[] = [];

  // 1. Occasional minor app source (3 device-less sleep nights outside watch windows -> "app" epoch)
  for (const day of ["2026-08-10", "2026-08-12", "2026-08-14"]) {
    records.push({
      type: TYPE.sleep,
      sourceName: APP_SOURCE,
      startDate: `${day} 23:30:00 +0900`,
      endDate: `${addIsoDays(day, 1)} 06:00:00 +0900`,
      value: SLEEP_VALUE.core,
      metadata: { HKTimeZone: "Asia/Tokyo" },
    });
  }

  // 2. Multi-year Watch A stretch in Dec 2025 (2025-12-01..2025-12-10)
  for (const [i, day] of daysBetween("2025-12-01", "2025-12-10").entries()) {
    pushNightSleep(records, day, WATCH_A_SOURCE, WATCH_A_10_4, "Asia/Tokyo", "+0900");
    pushNightVitals(records, day, i, WATCH_A_SOURCE, WATCH_A_10_4, "+0900", {
      hrvBase: 57 + pseudoNoise(i, 5, 2.5),
      rhrVal: 55 + pseudoNoise(i, 4, 1.5),
      respVal: 14.5 + pseudoNoise(i, 3, 0.3),
      tempVal: 36.48 + pseudoNoise(i, 5, 0.08),
    });
    records.push({
      type: TYPE.steps,
      sourceName: WATCH_A_SOURCE,
      unit: "count",
      startDate: `${day} 09:00:00 +0900`,
      endDate: `${day} 18:00:00 +0900`,
      value: String(Math.round(6400 + pseudoNoise(i, 5, 500))),
      device: WATCH_A_10_4,
    });
  }

  // 3. Watch A autumn stretch (2026-09-01..2026-10-15)
  // Watch A + Watch B overlap on hrv_sdnn/sleep/rhr for 2026-10-08..2026-10-15 (8 shared days -> offset seam).
  // Wrist temp stops on Watch A at 2026-10-06 and starts on Watch B at 2026-10-16 (0 shared -> step seam).
  for (const [i, day] of daysBetween("2026-09-01", "2026-10-15").entries()) {
    const dev = watchASwForDay(day);
    pushNightSleep(records, day, WATCH_A_SOURCE, dev, "Asia/Tokyo", "+0900");
    pushNightVitals(records, day, i, WATCH_A_SOURCE, dev, "+0900", {
      hrvBase: 56 + pseudoNoise(i, 7, 3.0),
      rhrVal: 55 + pseudoNoise(i, 6, 1.5),
      respVal: 14.6 + pseudoNoise(i, 5, 0.3),
      ...(day <= "2026-10-06" ? { tempVal: 36.5 + pseudoNoise(i, 6, 0.08) } : {}),
    });
    records.push({
      type: TYPE.steps,
      sourceName: WATCH_A_SOURCE,
      unit: "count",
      startDate: `${day} 10:00:00 +0900`,
      endDate: `${day} 17:00:00 +0900`,
      value: String(Math.round(6500 + pseudoNoise(i, 7, 600))),
      device: dev,
    });
    if (i % 5 === 0) {
      records.push({
        type: VO2_MAX_TYPE,
        sourceName: WATCH_A_SOURCE,
        unit: "mL/min·kg",
        startDate: `${day} 16:00:00 +0900`,
        endDate: `${day} 16:00:00 +0900`,
        value: (41.5 + i * 0.03).toFixed(1),
        device: dev,
      });
    }
  }

  // 4. Watch B overlap (2026-10-06..2026-10-15, 10 shared days -> offset seam -4 ms on HRV)
  for (const [i, day] of daysBetween("2026-10-06", "2026-10-15").entries()) {
    pushNightSleep(records, day, WATCH_B_SOURCE, WATCH_B_11_0, "Asia/Tokyo", "+0900");
    pushNightVitals(records, day, i, WATCH_B_SOURCE, WATCH_B_11_0, "+0900", {
      hrvBase: 52 + pseudoNoise(i, 5, 2.0),
      rhrVal: 56 + pseudoNoise(i, 4, 1.0),
      respVal: 14.7 + pseudoNoise(i, 3, 0.2),
    });
  }

  // 5. Watch B sole primary period (2026-10-16..2026-11-14)
  for (const [i, day] of daysBetween("2026-10-16", "2026-11-14").entries()) {
    const dev = watchBSwForDay(day);
    const isRecent = day >= "2026-11-08";
    const isTzNight = day === "2026-11-13";
    const tzName = isTzNight ? "Europe/London" : "Asia/Tokyo";
    const offsetStr = isTzNight ? "+0000" : "+0900";

    pushNightSleep(records, day, WATCH_B_SOURCE, dev, tzName, offsetStr);

    // Leave 2026-11-10 missing from HRV (missing_nights check + chart hole),
    // and 2026-11-11 with only 1 HRV sample (partial below_minimum).
    if (day !== "2026-11-10") {
      const hrvBase = isRecent ? 34 + pseudoNoise(i, 4, 1.8) : 52 + pseudoNoise(i, 6, 2.5);
      const rhrVal = isRecent ? 64.5 + pseudoNoise(i, 3, 1.0) : 56 + pseudoNoise(i, 5, 1.2);
      const respVal = 14.7 + pseudoNoise(i, 4, 0.25);
      const tempVal = 37.05 + pseudoNoise(i, 6, 0.06);
      const spo2Val = day >= "2026-11-05" ? 97.5 : undefined;

      pushNightVitals(records, day, i, WATCH_B_SOURCE, dev, offsetStr, {
        hrvBase,
        ...(day === "2026-11-11" ? { hrvSamples: 1 } : { hrvSamples: 3 }),
        rhrVal,
        respVal,
        tempVal,
        ...(spo2Val !== undefined ? { spo2Val } : {}),
      });
    } else {
      // Still emit complete RHR/resp/wrist_temp/spo2 on 2026-11-10 so only HRV has the gap
      const wakeDay = addIsoDays(day, 1);
      records.push(
        {
          type: TYPE.restingHeartRate,
          sourceName: WATCH_B_SOURCE,
          unit: "count/min",
          startDate: `${wakeDay} 06:15:00 +0900`,
          endDate: `${wakeDay} 06:15:00 +0900`,
          value: "65.0",
          device: dev,
        },
        {
          type: TYPE.respiratoryRate,
          sourceName: WATCH_B_SOURCE,
          unit: "count/min",
          startDate: `${wakeDay} 01:30:00 +0900`,
          endDate: `${wakeDay} 01:30:00 +0900`,
          value: "14.7",
          device: dev,
        },
        {
          type: TYPE.respiratoryRate,
          sourceName: WATCH_B_SOURCE,
          unit: "count/min",
          startDate: `${wakeDay} 03:00:00 +0900`,
          endDate: `${wakeDay} 03:00:00 +0900`,
          value: "14.8",
          device: dev,
        },
        {
          type: TYPE.respiratoryRate,
          sourceName: WATCH_B_SOURCE,
          unit: "count/min",
          startDate: `${wakeDay} 04:30:00 +0900`,
          endDate: `${wakeDay} 04:30:00 +0900`,
          value: "14.6",
          device: dev,
        },
        {
          type: TYPE.wristTemp,
          sourceName: WATCH_B_SOURCE,
          unit: "degC",
          startDate: `${wakeDay} 05:45:00 +0900`,
          endDate: `${wakeDay} 05:45:00 +0900`,
          value: "37.06",
          device: dev,
        },
        {
          type: TYPE.spo2,
          sourceName: WATCH_B_SOURCE,
          unit: "%",
          startDate: `${wakeDay} 01:20:00 +0900`,
          endDate: `${wakeDay} 01:20:00 +0900`,
          value: "97.6",
          device: dev,
        },
        {
          type: TYPE.spo2,
          sourceName: WATCH_B_SOURCE,
          unit: "%",
          startDate: `${wakeDay} 03:20:00 +0900`,
          endDate: `${wakeDay} 03:20:00 +0900`,
          value: "97.5",
          device: dev,
        },
        {
          type: TYPE.spo2,
          sourceName: WATCH_B_SOURCE,
          unit: "%",
          startDate: `${wakeDay} 05:20:00 +0900`,
          endDate: `${wakeDay} 05:20:00 +0900`,
          value: "97.4",
          device: dev,
        },
      );
    }

    // Daytime steps + HR + occasional VO2 max
    const stepsVal = isRecent ? 11_800 + i * 70 : 6500 + pseudoNoise(i, 6, 450);
    records.push({
      type: TYPE.steps,
      sourceName: WATCH_B_SOURCE,
      unit: "count",
      startDate: `${day} 10:00:00 +0900`,
      endDate: `${day} 18:00:00 +0900`,
      value: String(Math.round(stepsVal)),
      device: dev,
    });
    for (const h of ["11:00:00", "15:00:00"]) {
      records.push({
        type: TYPE.heartRate,
        sourceName: WATCH_B_SOURCE,
        unit: "count/min",
        startDate: `${day} ${h} +0900`,
        endDate: `${day} ${h} +0900`,
        value: String(Math.round(70 + pseudoNoise(i, 5, 3))),
        device: dev,
      });
    }
    if (i % 5 === 0) {
      records.push({
        type: VO2_MAX_TYPE,
        sourceName: WATCH_B_SOURCE,
        unit: "mL/min·kg",
        startDate: `${day} 16:00:00 +0900`,
        endDate: `${day} 16:00:00 +0900`,
        value: (42.8 + i * 0.04).toFixed(1),
        device: dev,
      });
    }
  }

  // 6. Phone epoch: primary for active_kj, also records overlapping steps on some days
  for (const [i, day] of daysBetween("2026-09-01", "2026-11-14").entries()) {
    records.push({
      type: TYPE.activeEnergy,
      sourceName: PHONE_SOURCE,
      unit: "kJ",
      startDate: `${day} 12:00:00 +0900`,
      endDate: `${day} 17:00:00 +0900`,
      value: String(Math.round(1850 + pseudoNoise(i, 6, 160))),
      device: PHONE_DEVICE,
    });
    if (i % 2 === 0) {
      records.push({
        type: TYPE.steps,
        sourceName: PHONE_SOURCE,
        unit: "count",
        startDate: `${day} 12:00:00 +0900`,
        endDate: `${day} 13:00:00 +0900`,
        value: String(Math.round(2400 + pseudoNoise(i, 4, 200))),
        device: PHONE_DEVICE,
      });
    }
  }

  return renderExport({
    exportDate: E2E_CORPUS_EXPORT_DATE,
    records,
    workouts: [],
  });
}

/**
 * Small follow-up export adding 4 daytime step records inside an older day (2026-08-20)
 * on Watch A so real POST /api/imports inserts new records without disturbing current asOfDay.
 */
export function buildE2eIncrementalUpdateXml(day = "2026-08-20"): string {
  const records: RecordSpec[] = ["09:00:00", "11:00:00", "14:00:00", "16:00:00"].map((h, idx) => ({
    type: TYPE.steps,
    sourceName: WATCH_A_SOURCE,
    unit: "count",
    startDate: `${day} ${h} +0900`,
    endDate: `${day} ${h} +0900`,
    value: String(1500 + idx * 100),
    device: WATCH_A_10_4,
  }));
  return renderExport({
    exportDate: E2E_CORPUS_EXPORT_DATE,
    records,
    workouts: [],
  });
}
