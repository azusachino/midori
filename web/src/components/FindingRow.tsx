import { Link } from "@tanstack/react-router";
import { Flag, Info } from "lucide-react";
import type { ConfidenceLevel, FindingRowDTO, FindingSeverity } from "@/api/types";
import { MetricIcon } from "@/components/MetricIcon";
import { RangeGauge } from "@/components/RangeGauge";
import { Sparkline } from "@/components/Sparkline";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { copy } from "@/copy";
import {
  flaggedChecksFor,
  formatReading,
  formatShortDay,
  isLeaning,
  unitNounFor,
} from "@/lib/finding-format";
import { cn } from "@/lib/utils";

export interface FindingRowProps {
  row: FindingRowDTO;
  mode?: "link" | "header";
  className?: string;
}

function barTintClass(severity: FindingSeverity): string {
  if (severity === "alert") return "bg-alert";
  if (severity === "notable") return "bg-notable";
  return "bg-transparent";
}

function directionTintClass(severity: FindingSeverity): string {
  if (severity === "alert") return "text-alert font-medium";
  if (severity === "notable") return "text-notable font-medium";
  return "text-muted-foreground";
}

const CONFIDENCE_GLYPH: Record<ConfidenceLevel, string> = {
  high: "◆",
  medium: "◇",
  low: "○",
};

export function FindingRow({ row, mode = "link", className }: FindingRowProps) {
  const metricLabel = copy.metrics[row.metric] ?? row.metric;
  const noun = unitNounFor(row.kind);
  const flaggedChecks = flaggedChecksFor(row);
  const reading = row.state === "computed" ? formatReading(row) : null;
  const isNotableOrAlert = row.severity === "notable" || row.severity === "alert";
  const showClippedZ = row.state === "computed" && row.z !== null && Math.abs(row.z) >= 10;

  const warmupPct =
    row.warmup && row.warmup.target > 0
      ? Math.round((row.warmup.current / row.warmup.target) * 100)
      : 0;

  return (
    <div
      data-testid={`finding-row-${row.metric}`}
      data-severity={row.severity}
      data-state={row.state}
      className={cn(
        "group relative flex items-stretch gap-3 px-4 py-3 text-sm transition-colors",
        mode === "link" && "hover:bg-muted/40",
        className,
      )}
    >
      {/* Left 3px severity tint bar (never the only signal) */}
      <span
        aria-hidden="true"
        className={cn("w-[3px] shrink-0 self-stretch rounded-full", barTintClass(row.severity))}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        {/* Primary line: metric name, prominent reading, trust popover, direction/state */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <MetricIcon metric={row.metric} className="text-muted-foreground" />
            {mode === "link" ? (
              <Link
                to="/metrics/$key"
                params={{ key: row.metric }}
                search={{ range: "90d", tab: "chart" }}
                className="font-medium text-foreground no-underline after:absolute after:inset-0 after:z-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
              >
                {metricLabel}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{metricLabel}</span>
            )}

            {reading ? (
              <span
                data-testid={`recent-value-${row.metric}`}
                className="text-sm font-semibold text-foreground tabular-nums whitespace-nowrap"
              >
                {reading}
              </span>
            ) : null}

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={copy.pages.changes.trustButtonLabel(metricLabel)}
                  data-testid={`trust-trigger-${row.metric}`}
                  className="relative z-10 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
                >
                  <Info aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent data-testid={`trust-popover-${row.metric}`}>
                <p className="font-medium text-foreground">{copy.trust[row.trust]}</p>
                <p className="mt-1 text-muted-foreground">{row.trustNote}</p>
              </PopoverContent>
            </Popover>

            {row.trust === "low" ? (
              <Badge variant="secondary" data-testid={`low-trust-${row.metric}`}>
                {copy.pages.changes.lowTrustBadge}
              </Badge>
            ) : null}

            {row.state === "computed" && row.direction ? (
              <span className={cn("text-xs md:text-sm", directionTintClass(row.severity))}>
                {isLeaning(row)
                  ? copy.leaning[(row.z ?? 0) > 0 ? "higher" : "lower"]
                  : copy.direction[row.direction]}
              </span>
            ) : null}

            {showClippedZ ? (
              <Badge
                variant={row.severity === "alert" ? "alert" : "notable"}
                className="tabular-nums"
              >
                {copy.pages.changes.clippedZ}
              </Badge>
            ) : null}

            {row.state === "warming_up" && row.warmup ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-learning">
                <span className="tabular-nums">
                  {copy.pages.changes.learningRow(row.warmup.current, row.warmup.target, noun)}
                </span>
                <Progress
                  value={warmupPct}
                  aria-label={copy.pages.changes.learningRow(
                    row.warmup.current,
                    row.warmup.target,
                    noun,
                  )}
                  className="h-1.5 w-20 bg-muted [&>div]:bg-learning"
                />
              </div>
            ) : null}

            {row.state === "insufficient" ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {copy.pages.changes.insufficientRow(row.recentCount, noun)}
              </span>
            ) : null}

            {row.state === "stale" ? (
              <span className="text-xs text-muted-foreground">
                {copy.pages.changes.staleRow(noun)}
              </span>
            ) : null}
          </div>

          <RangeGauge row={row} />
        </div>

        {/* Secondary cluster: frequency, onset, confidence, flagged checks, sparkline */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs md:justify-end">
          {row.state === "computed" && row.kOutside !== null ? (
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
              {copy.pages.changes.frequency(row.kOutside, row.recentCount, noun)}
            </span>
          ) : null}

          {row.state === "computed" && isNotableOrAlert && row.onset ? (
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
              {copy.pages.changes.onset(formatShortDay(row.onset.day), row.onset.openEnded)}
            </span>
          ) : null}

          {row.state === "computed" && row.confidence ? (
            <span className="text-muted-foreground whitespace-nowrap">
              <span aria-hidden="true" className="mr-1">
                {CONFIDENCE_GLYPH[row.confidence]}
              </span>
              {copy.confidence[row.confidence]}
            </span>
          ) : null}

          {flaggedChecks.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={copy.pages.changes.checksButtonLabel(
                    metricLabel,
                    flaggedChecks.length,
                  )}
                  data-testid={`checks-trigger-${row.metric}`}
                  className="relative z-10 inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-xs text-notable hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring tabular-nums cursor-pointer"
                >
                  <Flag aria-hidden="true" className="h-3 w-3" />
                  <span>{flaggedChecks.length}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" data-testid={`checks-popover-${row.metric}`}>
                <p className="font-medium text-foreground">{copy.pages.changes.checksHeading}</p>
                <ul className="mt-1.5 space-y-1 text-muted-foreground">
                  {flaggedChecks.map((check) => (
                    <li key={check.key} className="flex items-start gap-1.5">
                      <Flag aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-notable" />
                      <span>
                        {copy.checks[check.key]}
                        {check.day ? ` (${formatShortDay(check.day)})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}

          <Sparkline
            metricLabel={metricLabel}
            points={row.sparkline}
            baselineLow={row.baselineLow}
            baselineHigh={row.baselineHigh}
            severity={row.severity}
          />
        </div>
      </div>
    </div>
  );
}
