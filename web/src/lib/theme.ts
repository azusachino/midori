/**
 * Design-system color tokens (ui-design §9) shared between Tailwind CSS variables,
 * ECharts theme reading, and contrast/colorblind validation tests.
 */

export const THEME_DEFAULTS = {
  background: "#09090b",
  foreground: "#f4f4f5",
  card: "#18181b",
  muted: "#27272a",
  mutedForeground: "#a1a1aa",
  border: "#27272a",
  borderStrong: "#3f3f46",
  accent: "#34d399",
  primaryForeground: "#09090b",
  notable: "#fbbf24",
  alert: "#fb7185",
  learning: "#38bdf8",
  partial: "#a1a1aa",
  minor: "#71717a",
} as const;

export const EPOCH_PALETTE = [
  "#2dd4bf", // teal
  "#747ef8", // indigo
  "#fb923c", // orange
  "#f0abfc", // orchid
  "#bef264", // lime
  "#bae6fd", // ice
] as const;

export interface ChartTheme {
  background: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  borderStrong: string;
  accent: string;
  notable: string;
  alert: string;
  learning: string;
  partial: string;
  minor: string;
  epochs: readonly string[];
  fontSans: string;
}

function readVar(styles: CSSStyleDeclaration | null, name: string, fallback: string): string {
  if (!styles) return fallback;
  const val = styles.getPropertyValue(name).trim();
  return val.length > 0 ? val : fallback;
}

/** Reads resolved CSS theme tokens from :root for ECharts, with safe fallbacks. */
export function readChartTheme(): ChartTheme {
  const styles =
    typeof window !== "undefined" && typeof document !== "undefined"
      ? window.getComputedStyle(document.documentElement)
      : null;

  return {
    background: readVar(styles, "--color-background", THEME_DEFAULTS.background),
    card: readVar(styles, "--color-card", THEME_DEFAULTS.card),
    foreground: readVar(styles, "--color-foreground", THEME_DEFAULTS.foreground),
    mutedForeground: readVar(styles, "--color-muted-foreground", THEME_DEFAULTS.mutedForeground),
    border: readVar(styles, "--color-border", THEME_DEFAULTS.border),
    borderStrong: readVar(styles, "--color-border-strong", THEME_DEFAULTS.borderStrong),
    accent: readVar(styles, "--color-accent", THEME_DEFAULTS.accent),
    notable: readVar(styles, "--color-notable", THEME_DEFAULTS.notable),
    alert: readVar(styles, "--color-alert", THEME_DEFAULTS.alert),
    learning: readVar(styles, "--color-learning", THEME_DEFAULTS.learning),
    partial: readVar(styles, "--color-partial", THEME_DEFAULTS.partial),
    minor: readVar(styles, "--color-minor", THEME_DEFAULTS.minor),
    epochs: [
      readVar(styles, "--color-epoch-1", EPOCH_PALETTE[0]),
      readVar(styles, "--color-epoch-2", EPOCH_PALETTE[1]),
      readVar(styles, "--color-epoch-3", EPOCH_PALETTE[2]),
      readVar(styles, "--color-epoch-4", EPOCH_PALETTE[3]),
      readVar(styles, "--color-epoch-5", EPOCH_PALETTE[4]),
      readVar(styles, "--color-epoch-6", EPOCH_PALETTE[5]),
    ],
    fontSans: readVar(
      styles,
      "--font-sans",
      'system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif',
    ),
  };
}

/** Returns the categorical color for a non-minor epoch index (wraps after 6). */
export function epochColor(index: number, palette: readonly string[] = EPOCH_PALETTE): string {
  return palette[Math.abs(index) % palette.length] ?? EPOCH_PALETTE[0];
}
