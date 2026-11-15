import { buildFixture, type ExportSpec, type RecordSpec, SLEEP_VALUE, TYPE } from "./model";

export const REPLACEMENT_SOURCE = "Synthetic Same Name Watch";

function device(hardware: string, software: string): string {
  return `<<HKDevice: fixture>, name:Same Name Watch, hardware:${hardware}, software:${software}, model:Watch>`;
}

function sample(day: string, hardware: string, value: string, software?: string): RecordSpec {
  const startDate = `${day} 07:00:00 +0900`;
  return {
    type: TYPE.heartRate,
    sourceName: REPLACEMENT_SOURCE,
    unit: "count/min",
    startDate,
    endDate: startDate,
    value,
    device: device(hardware, software ?? (hardware === "Watch5,9" ? "10.0" : "11.0")),
  };
}

function sleep(day: string): RecordSpec {
  return {
    type: TYPE.sleep,
    sourceName: REPLACEMENT_SOURCE,
    startDate: `${day} 23:00:00 +0900`,
    endDate: `${day} 23:30:00 +0900`,
    value: SLEEP_VALUE.core,
    metadata: { HKTimeZone: "Asia/Tokyo" },
  };
}

export function replacementWatchSpec(): ExportSpec {
  return {
    exportDate: "2026-04-06 08:00:00 +0900",
    records: [
      sample("2026-04-01", "Watch5,9", "54"),
      sample("2026-04-02", "Watch5,9", "55"),
      sleep("2026-04-02"),
      {
        type: TYPE.restingHeartRate,
        sourceName: REPLACEMENT_SOURCE,
        unit: "count/min",
        startDate: "2026-04-02 07:00:00 +0900",
        endDate: "2026-04-02 07:00:00 +0900",
        value: "56",
      },
      sample("2026-04-04", "Watch7,5", "52"),
      { ...sleep("2026-04-03"), value: SLEEP_VALUE.deep },
      {
        type: TYPE.restingHeartRate,
        sourceName: REPLACEMENT_SOURCE,
        unit: "count/min",
        startDate: "2026-04-04 07:00:00 +0900",
        endDate: "2026-04-04 07:00:00 +0900",
        value: "53",
      },
      sample("2026-04-05", "Watch7,5", "51", "11.1"),
    ],
    workouts: [],
  };
}

export const replacementWatch = buildFixture("replacement-watch", replacementWatchSpec(), {
  epochs: 2,
  inheritedSleepRecords: 2,
  inheritedRestingHeartRateRecords: 2,
});
