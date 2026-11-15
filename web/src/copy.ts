/**
 * Every user-visible string in the web app lives here (grill Q6: centralized, EN-first).
 * Components reference keys; they never inline prose. Placeholder pages carry their
 * intent text until their tasks (17–19) replace them with real content.
 */
export const copy = {
  app: {
    name: "midori",
    tagline: "Apple Health admin dashboard",
    skipToContent: "Skip to content",
  },
  nav: {
    label: "Primary",
    briefing: "Briefing",
    investigate: "Investigate",
    import: "Import",
  },
  pages: {
    briefing: {
      title: "Briefing",
      placeholder: "The briefing shows how you are doing in one glance. Coming in a later step.",
    },
    investigate: {
      title: "Investigate",
      placeholder:
        "Pick a metric and a window to see deviations from your own baseline. Coming in a later step.",
    },
    import: {
      title: "Import",
      placeholder: "Drop an Apple Health export.zip to import it. Coming in a later step.",
    },
    notFound: {
      title: "Page not found",
      body: "There is no page at this address.",
      back: "Go to Briefing",
    },
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
    done: "Done",
    failed: "Failed",
  },
  trust: {
    high: "High trust",
    moderate: "Moderate trust",
    low: "Low trust",
  },
  severity: {
    info: "Info",
    notable: "Notable",
    alert: "Alert",
  },
} as const;

export type Copy = typeof copy;
