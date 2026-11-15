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
    baselineLowCol: "Baseline low",
    baselineHighCol: "Baseline high",
    baselineBandLabel: "Usual range",
    baselineMedianLabel: "Usual median",
    recentWindowLabel: "last 7",
    osUpdateLabel: "OS update",
    minorEpochNote: "Secondary source",
    seamOffset: (fromLabel: string, toLabel: string, offsetText: string) =>
      `${fromLabel} → ${toLabel} · offset ${offsetText}`,
    seamStep: (stepText: string) => `step ${stepText} (can't be separated)`,
    partialExportCut: "partial (export cut)",
    partialBelowMin: "partial (too few samples)",
    partialGeneric: "partial",
    tzShiftNote: "tz shift",
    smokeSummary: (metricLabel: string, count: number) =>
      `${metricLabel} series with ${count} synthetic units.`,
  },
  pages: {
    changes: {
      title: "Changes",
      asOf: (day: string) => `as of ${day}`,
      staleBanner: (daysAgo: number, span: string) =>
        `Your last import was ${daysAgo} days ago. Findings describe ${span}.`,
      staleImportCta: "Import",
      warmingNotice: (
        metricLabel: string,
        current: number,
        target: number,
        readyDay: string | null,
      ) =>
        readyDay
          ? `Learning your new watch — ${metricLabel}: ${current} of ${target} usable nights. First reading around ${readyDay}. Other overnight metrics are ready.`
          : `Learning your new watch — ${metricLabel}: ${current} of ${target} usable nights. Other overnight metrics are ready.`,
      devicesCta: "Devices",
      allWithin: (count: number) => `Nothing stands out across ${count} overnight metrics.`,
      overnightTitle: "Overnight",
      rankedHint: "ranked by distance from usual",
      daytimeTitle: "Daytime",
      daytimeHint: "only rows that are notable or alert",
      frequency: (k: number, recentCount: number, noun: "nights" | "days") =>
        `${k}/${recentCount} ${noun}`,
      onset: (day: string, openEnded: boolean) =>
        openEnded ? `at least since ${day}` : `since ${day}`,
      clippedZ: "≥10σ",
      learningRow: (current: number, target: number, noun: "nights" | "days") =>
        `learning · ${current} of ${target} ${noun}`,
      insufficientRow: (recentCount: number, noun: "nights" | "days") =>
        `not enough ${noun} · ${recentCount} of 4 recent`,
      staleRow: (noun: "nights" | "days") => `no recent ${noun}`,
      lowTrustBadge: "low trust",
      trustButtonLabel: (metricLabel: string) => `${metricLabel} data trust details`,
      checksButtonLabel: (metricLabel: string, count: number) =>
        `${metricLabel}: ${count} flagged checks`,
      checksHeading: "Flagged checks",
      sparklineAria: (metricLabel: string, count: number, hasClipped: boolean) =>
        hasClipped
          ? `${metricLabel} trend across ${count} units (capped at ≥10σ)`
          : `${metricLabel} trend across ${count} units`,
      lastNight: {
        title: (dayLabel: string) => `Last complete night — ${dayLabel}`,
        emptyTitle: "Last complete night",
        noneRecent: "No complete night in the last 14 days.",
        breakdown: (asleepH: string, deepH: string, remH: string, coreH: string) =>
          `asleep ${asleepH} h · deep ${deepH} · REM ${remH} · core ${coreH}`,
        skippedExportCut: (dayLabel: string) => `${dayLabel} skipped: export taken before noon.`,
        stageBarAria: (deepH: string, remH: string, coreH: string) =>
          `Sleep stages: deep ${deepH} h, REM ${remH} h, core ${coreH} h`,
        stageLegend: {
          deep: "Deep",
          rem: "REM",
          core: "Core",
        },
      },
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
      rangeGroupLabel: "Time range",
      resetZoom: "Reset zoom",
      trendOnlyNote: "Trend only — no baseline comparison",
      longViewPlaceholder: "Long view bands and milestone markers land in Slice 16.",
      emptyRange: (noun: "nights" | "days") => `No ${noun} in this range`,
      widenRangeCta: (nextRangeLabel: string) => `Show ${nextRangeLabel}`,
      recentUnitsTitle: (noun: "nights" | "days") => `Recent ${noun}`,
      recentTable: {
        colDay: "Date",
        colValue: "Value",
        colZ: "vs usual",
        colDevice: "Device",
        colNotes: "Notes",
      },
      baselineSummary: (
        count: number,
        noun: "nights" | "days",
        medianText: string,
        lowText: string,
        highText: string,
        spanText: string | null,
      ) =>
        spanText
          ? `Baseline: ${count} ${noun} · median ${medianText} (${lowText}–${highText}) · ${spanText}`
          : `Baseline: ${count} ${noun} · median ${medianText} (${lowText}–${highText})`,
      noBaselineYet: "Baseline: warming up — not yet established",
      noBaselineTrendOnly: "Trend only — no baseline range computed",
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
      dropzoneLabel: "Drop export.zip here, or",
      chooseFile: "Choose file",
      fileInputLabel: "Choose export.zip file",
      dropzoneInstructions:
        "On iPhone: Health → profile → Export All Health Data → Save to Files, then come back here and tap Choose file.",
      dropzoneDisabled: "One import at a time",
      uploadingTitle: (name: string) => `Uploading ${name}`,
      uploadingBytes: (loaded: string, total: string) => `${loaded} / ${total}`,
      keepTabOpen: "Keep this tab open until the upload finishes.",
      canCloseTab: "You can close this tab now.",
      stages: {
        queued: "Uploaded",
        unpacking: "Unpacked",
        parsing: "Parsing",
        storing: "Storing",
        deriving: "Deriving",
      },
      errors: {
        notHealthExport: "This isn't a Health export (export.xml not found).",
        uploadInterrupted: "Upload interrupted — choose the file again.",
        uploadTooLarge: "This file exceeds the 512 MB upload limit.",
        alreadyRunning: "One import at a time",
        retryExpired: "Upload the file again.",
      },
      summary: {
        nothingNew: "Nothing new: 0 new records.",
        newRecords: (n: number) => `${n.toLocaleString()} new records`,
        alreadyKnown: (n: number) => `${n.toLocaleString()} already known`,
        newUsableNights: (n: number) => `${n.toLocaleString()} new usable nights`,
        dataThrough: (day: string) => `Data through ${day}`,
        newEpochs: (labels: readonly string[]) => `New device: ${labels.join(", ")}`,
        olderExportWarning: "This export is older than data you already have; nothing is removed.",
        topChangesPrefix: "Top changes now:",
        seeChangesCta: "See what changed →",
      },
      failed: {
        title: "Import failed",
        stageLabel: (stage: string) => `Stage: ${stage}`,
        retry: "Retry",
        retrying: "Retrying…",
      },
      historyTitle: "History",
      noImportsYet: "No imports yet",
      rowWhen: "When",
      rowExportDate: "Export date",
      rowNew: "New",
      rowKnown: "Known",
      rowNightsAdded: "Nights added",
      rowDuration: "Duration",
      rowStatus: "Status",
      rowActions: "Action",
    },
    notFound: {
      title: "Page not found",
      body: "There is no page at this address.",
      back: "Go to Changes",
    },
  },
} as const;

export type Copy = typeof copy;
