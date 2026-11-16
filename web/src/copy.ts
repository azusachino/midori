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
  /** B-F12 "close to the edge" wording for leaning within rows. */
  leaning: {
    higher: "slightly higher than usual",
    lower: "slightly lower than usual",
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
      answerNone: "Nothing stands out in your last 7 nights.",
      answerSome: (count: number) =>
        `${count} ${count === 1 ? "metric stands out" : "metrics stand out"} in your recent data.`,
      answerDetail: (within: number, other: number) =>
        other > 0
          ? `${within} overnight within usual · ${other} still learning or short of data.`
          : `${within} overnight ${within === 1 ? "metric" : "metrics"} within usual.`,
      standsOutTitle: "Stands out",
      closeToEdgeTitle: "Close to the edge",
      closeToEdgeHint: "within usual, nearest the band edge",
      showAll: (count: number) => `Show all ${count} overnight metrics`,
      showMore: (count: number) =>
        `Show ${count} more overnight ${count === 1 ? "metric" : "metrics"}`,
      hideAll: "Hide the full list",
      overnightTitle: "Overnight",
      emptyOvernight: "No overnight metrics with data yet.",
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
        `${metricLabel}: ${count} ${count === 1 ? "flagged check" : "flagged checks"}`,
      checksHeading: "Flagged checks",
      sparklineAria: (metricLabel: string, count: number, hasClipped: boolean) => {
        const unitWord = count === 1 ? "unit" : "units";
        return hasClipped
          ? `${metricLabel} trend across ${count} ${unitWord} (capped at ≥10σ)`
          : `${metricLabel} trend across ${count} ${unitWord}`;
      },
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
      noDataYet: "No data yet",
      trendOnlySummary: "Trend only — no baseline",
      weeklySummary: (metricLabel: string, count: number, seamCount: number) => {
        const weekWord = count === 1 ? "week" : "weeks";
        const seamWord = seamCount === 1 ? "device seam" : "device seams";
        return seamCount > 0
          ? `${metricLabel} 1-year weekly trend across ${count} ${weekWord} with ${seamCount} ${seamWord}.`
          : `${metricLabel} 1-year weekly trend across ${count} ${weekWord}.`;
      },
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
      longView: {
        summary: (metricLabel: string, count: number, yearCount: number) =>
          `${metricLabel} calendar across ${count} ${count === 1 ? "unit" : "units"} in ${yearCount} ${yearCount === 1 ? "year" : "years"}.`,
        noData: "No units available for Long view",
        legendLower: "Lower",
        legendMedian: "Stint median",
        legendHigher: "Higher",
        legendPartial: "Partial (hatched)",
        legendSeam: "Device seam",
        colYear: "Year",
        colDeviation: "vs stint median",
        colPartial: "Partial",
        colSeam: "Seam",
        fromStintMedian: (diffText: string) => `${diffText} vs stint median`,
      },
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
      ) => {
        const unitWord = count === 1 ? (noun === "days" ? "day" : "night") : noun;
        return spanText
          ? `Baseline: ${count} ${unitWord} · median ${medianText} (${lowText}–${highText}) · ${spanText}`
          : `Baseline: ${count} ${unitWord} · median ${medianText} (${lowText}–${highText})`;
      },
      noBaselineYet: "Baseline: warming up — not yet established",
      noBaselineTrendOnly: "Trend only — no baseline range computed",
      unknownTitle: "Unknown metric",
      unknownBody: (key: string) => `“${key}” is not a recognized midori metric.`,
      knownListLabel: "Known metrics",
      checksTitle: "Checks",
      checkStatusClear: "Clear",
      checkStatusFlagged: "Flagged",
      checksDevicesLink: "Devices",
      checksInspectUnit: (dayLabel: string) => `Open ${dayLabel}`,
      checksClearLabels: {
        device_change: "No device change in last 35 days",
        os_update: "No OS update in last 35 days",
        partial_nights: (noun: "nights" | "days") => `No partial ${noun} skipped`,
        tz_change: "No timezone change",
        missing_nights: (noun: "nights" | "days") => `No missing ${noun}`,
        trust: (trustLabel: string) => `Trust: ${trustLabel}`,
      },
      checksFlaggedLabels: {
        device_change: (dayLabel?: string) =>
          dayLabel
            ? `Device change in last 35 days (${dayLabel})`
            : "Device change in last 35 days",
        os_update: (dayLabel?: string) =>
          dayLabel ? `OS update in last 35 days (${dayLabel})` : "OS update in last 35 days",
        partial_nights: (count: number | undefined, noun: "nights" | "days", dayLabel?: string) => {
          const singular = noun === "days" ? "day" : "night";
          const unitWord = count === 1 ? singular : noun;
          const prefix =
            count !== undefined && count > 0
              ? `${count} partial ${unitWord} skipped`
              : `Partial ${noun} skipped`;
          return dayLabel ? `${prefix} (${dayLabel})` : prefix;
        },
        tz_change: (dayLabel?: string) =>
          dayLabel ? `Timezone change (${dayLabel})` : "Timezone change in recent window",
        missing_nights: (noun: "nights" | "days", dayLabel?: string) =>
          dayLabel ? `Missing ${noun} (${dayLabel})` : `Missing ${noun} in recent window`,
        low_trust: "Trust: low",
      },
      evidence: {
        title: (prefix: string, metricLabel: string) => `${prefix} · ${metricLabel}`,
        nightPrefix: (weekdayDate: string) => `Night of ${weekdayDate}`,
        dayPrefix: (weekdayDate: string) => `Day of ${weekdayDate}`,
        sheetDescription: "Recorded unit evidence and source details.",
        valueSummary: (valueText: string, sampleCount: number, windowLabel: string) =>
          `Value ${valueText} (${sampleCount} ${sampleCount === 1 ? "sample" : "samples"}, ${windowLabel})`,
        valueMedianSummary: (valueText: string, sampleCount: number, windowLabel: string) =>
          `Value ${valueText} (median of ${sampleCount} ${sampleCount === 1 ? "sample" : "samples"}, ${windowLabel})`,
        noSamplesNight: "No samples stored for this night",
        noSamplesDay: "No samples stored for this day",
        devicePrefix: "Device",
        unknownDevice: "Primary source unavailable",
        usableLabel: "usable",
        partialLabel: (reason: string | null) => (reason ? `partial (${reason})` : "partial"),
        samplesHeading: "Samples",
        sleepHeading: "Sleep",
        sleepWindow: (startLocal: string, endLocal: string, asleepH: string) =>
          `${startLocal}–${endLocal} · asleep ${asleepH} h`,
        alsoRecordedBy: "Also recorded by:",
        copyLink: "Copy link",
        copiedLink: "Link copied",
        loadingLabel: "Loading evidence…",
        loadError: "Couldn't load unit evidence.",
        retryLabel: "Retry",
        closeLabel: "Close evidence sheet",
        sampleWindowOvernight: "21:00–09:00",
      },
    },
    devices: {
      title: "Devices",
      subtitle: "Device epochs, metric primaries, seams, and OS updates.",
      timelineTitle: "Timeline (days present)",
      timelineSummary: (epochCount: number, minorCount: number) => {
        const primaryWord =
          epochCount === 1 ? "primary or secondary epoch" : "primary or secondary epochs";
        const minorWord = minorCount === 1 ? "occasional source" : "occasional sources";
        return minorCount > 0
          ? `Device timeline across ${epochCount} ${primaryWord} and ${minorCount} ${minorWord}.`
          : `Device timeline across ${epochCount} ${epochCount === 1 ? "epoch" : "epochs"}.`;
      },
      lanes: {
        watch: "Watch",
        phone: "Phone",
        app: "Apps",
      },
      primaryFor: (count: number) =>
        count === 1 ? "primary for 1 metric" : `primary for ${count} metrics`,
      sincePrefix: (dayLabel: string) => `since ${dayLabel}`,
      daysCount: (count: number) => (count === 1 ? "1 day" : `${count} days`),
      osUpdatesLabel: "OS updates",
      osUpdatesMore: (count: number) => `${count} more`,
      osUpdatesLess: "Show less",
      noMetricsNote: "No primary metrics in current derive.",
      occasionalTitle: (count: number) => `Occasional sources (${count})`,
      occasionalHint: "Minor sources with fewer than 6 days in any 28-day window; never primary.",
      legendSparseDot: "Sparse source",
      legendOsUpdate: "OS update",
      columns: {
        metric: "Metric",
        baseline: "Baseline",
        seam: "Across device change",
        seamFrom: (fromLabel: string) => `Across change from ${fromLabel}`,
      },
      roles: {
        primary: "primary",
        candidate: "candidate",
        former: "former",
        formerPrimary: "former primary",
        minor: "minor",
      },
      baselines: {
        full: "full",
        early: "early",
        learning: (current: number, target: number) => `learning ${current}/${target}`,
        learningGeneric: "learning",
        insufficient: "insufficient",
        trendOnly: "trend only",
      },
      seamOffset: (diffText: string, sharedDays: number) =>
        `offset ${diffText} (n=${sharedDays} shared ${sharedDays === 1 ? "day" : "days"})`,
      seamStep: (diffText: string) => `step ${diffText} — device or you, can't separate`,
      kinds: {
        watch: "Watch",
        phone: "Phone",
        app: "App",
        other: "Device",
      },
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
        newRecords: (n: number) =>
          `${n.toLocaleString()} ${n === 1 ? "new record" : "new records"}`,
        alreadyKnown: (n: number) => `${n.toLocaleString()} already known`,
        newUsableNights: (n: number) =>
          `${n.toLocaleString()} ${n === 1 ? "new usable night" : "new usable nights"}`,
        dataThrough: (day: string) => `Data through ${day}`,
        newEpochs: (labels: readonly string[]) =>
          `${labels.length === 1 ? "New device" : "New devices"}: ${labels.join(", ")}`,
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
