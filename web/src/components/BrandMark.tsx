import { cn } from "@/lib/utils";

/**
 * The evergreen brand mark: two overlapping geometric tiers over a trunk. Decorative
 * only — `aria-hidden="true"` and no `<title>`, so the surrounding link's accessible
 * name stays exactly `copy.app.name` (e2e/shell.spec.ts).
 */
export function BrandMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-testid="brand-mark"
      className={cn("shrink-0 text-accent", className)}
    >
      <path d="M16 3 25 15.5H7L16 3Z" fill="currentColor" />
      <path d="M16 11 28.5 27H3.5L16 11Z" fill="currentColor" fillOpacity="0.72" />
      <rect x="14.75" y="24" width="2.5" height="5.5" rx="0.8" fill="currentColor" />
    </svg>
  );
}
