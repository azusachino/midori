/**
 * Single centralized UI copy module (docs/design.md + docs/ui-design.md).
 * Neutral language only (B-F9): never "better", "worse", "caused", or "your watch is wrong".
 */
export const copy = {
  app: {
    name: "midori",
    skipToContent: "Skip to content",
  },
  nav: {
    label: "Primary",
    changes: "Changes",
    metrics: "Metrics",
    devices: "Devices",
    import: "Import",
  },
  topbar: {
    freshness: (asOf: string, daysAgo: number) =>
      `Data through ${asOf} · imported ${daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`}`,
    noImports: "No imports yet",
    importingPill: (stage: string, progressPct: number | null) =>
      progressPct === null
        ? `Import running · ${stage}`
        : `Import running · ${stage} ${Math.round(progressPct)}%`,
  },
  sidebar: {
    watchHeading: "watch",
    learningProgress: (current: number, target: number) => `learning ${current}/${target}`,
    noPrimaryWatch: "No primary watch yet",
  },
  empty: {
    title: "No Health data imported yet",
    subtitle: "Export your Apple Health archive from your iPhone, then import it here.",
    steps: [
      {
        step: "1",
        title: "Open Health on your iPhone",
        body: "Tap your profile picture in the top-right corner.",
      },
      {
        step: "2",
        title: "Export All Health Data",
        body: "Choose Save to Files so export.zip is ready to upload.",
      },
      {
        step: "3",
        title: "Import export.zip here",
        body: "Open the Import page and choose the saved archive.",
      },
    ],
    cta: "Go to Import",
  },
  loading: {
    label: "Loading…",
  },
  error: {
    title: "Couldn't load this view.",
    changesTitle: "Couldn't load changes.",
    metricsTitle: "Couldn't load metrics.",
    metricDetailTitle: "Couldn't load this metric.",
    devicesTitle: "Couldn't load devices.",
    importsTitle: "Couldn't load import history.",
    retry: "Retry",
  },
  api: {
    networkError: "Could not reach the midori server. Check that it is running.",
    unknownError: "The server returned an unexpected response.",
    importFailed: "The import failed.",
    importNotFound: "This import no longer exists.",
    aborted: "The request was cancelled.",
  },
  status: {
    queued: "Queued",
    unpacking: "Unpacking",
    parsing: "Parsing",
    storing: "Storing",
    deriving: "Deriving",
    done: "Done",
    failed: "Failed",
  },
  metrics: {
    sleep_h: "Sleep",
    deep_h: "Deep sleep",
    rem_h: "REM sleep",
    sleep_hr: "Sleeping HR",
    hrv_sdnn: "HRV (SDNN)",
    hrv_rmssd: "HRV (RMSSD)",
    rhr: "Resting HR",
    resp_rate: "Resp. rate",
    wrist_temp: "Wrist temp",
    spo2: "SpO₂",
    steps: "Steps",
    active_kj: "Active energy",
    heart_rate: "Heart rate",
    vo2max: "VO₂ max",
  } as Record<string, string>,
  trust: {
    high: "high trust",
    moderate: "moderate trust",
    low: "low trust",
  },
  direction: {
    higher: "higher than usual",
    lower: "lower than usual",
    within: "within usual",
  },
  confidence: {
    high: "high",
    medium: "medium",
    low: "low",
  },
  checks: {
    device_change: "Device change in last 35 days",
    os_update: "OS update in last 35 days",
    partial_nights: "Partial nights skipped",
    tz_change: "Timezone change in recent window",
    missing_nights: "Missing nights in recent window",
    low_trust: "Low trust metric",
  },
  chart: {
    dayCol: "Date",
    valueCol: "Value",
    unitCol: "Unit",
    epochCol: "Device",
    usableCol: "Usable",
    smokeSummary: (metricLabel: string, count: number) =>
      `${metricLabel} series with ${count} synthetic units.`,
  },
  pages: {
    changes: {
      title: "Changes",
      asOf: (day: string) => `as of ${day}`,
      overnightTitle: "Overnight",
      rankedHint: "ranked by distance from usual",
      placeholderNote:
        "Foundation shell active. Full ranked overnight/daytime findings and last-night cards land in Slice 13.",
      smokePreviewTitle: "Wrist temperature trend preview",
      openMetric: "Open metric detail",
    },
    metrics: {
      title: "Metrics",
      subtitle: "One card per metric, ordered overnight, daytime, then trend-only.",
      placeholderNote:
        "Foundation shell active. Full 1-year mini charts per metric land in Slice 16.",
      groups: {
        overnight: "Overnight",
        daytime: "Daytime",
        trendOnly: "Trend only",
      },
    },
    metricDetail: {
      backToChanges: "Changes",
      tabs: {
        chart: "Chart",
        long: "Long view",
      },
      ranges: {
        "90d": "90d",
        "180d": "180d",
        "1y": "1y",
        all: "All",
      },
      trendOnlyNote: "Trend only — no baseline comparison",
      placeholderNote:
        "Foundation shell active. Full baseline band, seam markers, confounder checks, and night evidence sheet land in Slices 14–16.",
      unknownTitle: "Unknown metric",
      unknownBody: (key: string) => `“${key}” is not a recognized midori metric.`,
      knownListLabel: "Known metrics",
    },
    devices: {
      title: "Devices",
      subtitle: "Device epochs, metric primaries, seams, and OS updates.",
      placeholderNote:
        "Foundation shell active. Full epoch timeline and per-epoch cards land in Slice 17.",
      primaryFor: (count: number) => `primary for ${count} metrics`,
    },
    import: {
      title: "Import",
      subtitle: "Upload an Apple Health export.zip to update derived baselines and findings.",
      placeholderNote:
        "Foundation shell active. Full XHR upload progress, stage stepper, and retry controls land in Slice 12.",
      historyTitle: "History",
      noImportsYet: "No imports yet",
      rowWhen: "When",
      rowZip: "Archive",
      rowNew: "New",
      rowKnown: "Known",
      rowDuration: "Duration",
      rowStatus: "Status",
    },
    notFound: {
      title: "Page not found",
      body: "There is no page at this address.",
      back: "Go to Changes",
    },
  },
} as const;

export type Copy = typeof copy;
