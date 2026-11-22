import type { FindingRowDTO } from "@/api/types";
import { copy } from "@/copy";
import {
  displayUnit,
  formatMetricNumber,
  formatValueWithUnit,
  isFractionPercent,
} from "@/lib/finding-format";
import { buildRangeGaugeGeometry } from "@/lib/range-gauge";
import { cn } from "@/lib/utils";

export interface RangeGaugeProps {
  row: FindingRowDTO;
  className?: string;
}

/**
 * Fixed-proportion horizontal usual-range gauge (v3 plan §5). Always
 * `pointer-events-none`: `FindingRow`'s stretched link keeps the whole row clickable.
 */
export function RangeGauge({ row, className }: RangeGaugeProps) {
  const geometry = buildRangeGaugeGeometry(row);
  if (
    !geometry ||
    row.recentMedian === null ||
    row.baselineLow === null ||
    row.baselineHigh === null ||
    isFractionPercent(row.unit, row.recentMedian, row.baselineMedian)
  ) {
    return null;
  }

  const metricLabel = copy.metrics[row.metric] ?? row.metric;
  const unitLabel = displayUnit(row.metric, row.unit);
  const recentText = formatValueWithUnit(row.recentMedian, row.metric, row.unit);
  const low = Math.min(row.baselineLow, row.baselineHigh);
  const high = Math.max(row.baselineLow, row.baselineHigh);
  const lowText = formatValueWithUnit(low, row.metric, row.unit);
  const highText = formatValueWithUnit(high, row.metric, row.unit);
  const rangeText = `${formatMetricNumber(low, row.metric, row.unit)}–${formatMetricNumber(high, row.metric, row.unit)}`;
  const direction =
    row.direction === "higher" ? "higher" : row.direction === "lower" ? "lower" : "within";

  return (
    <div className="pointer-events-none flex shrink-0 items-center gap-2">
      <div
        data-testid={`range-gauge-${row.metric}`}
        data-in-band={geometry.inBand ? "true" : "false"}
        data-direction={direction}
        className={cn("relative h-2 w-28 rounded-full bg-muted sm:w-32", className)}
        role="img"
        aria-label={copy.pages.changes.gaugeAria(metricLabel, recentText, lowText, highText)}
      >
        {/* usual band occupies a fixed middle 40% of the track */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 rounded-full bg-accent/25"
          style={{ left: `${geometry.bandLeftPct}%`, width: `${geometry.bandWidthPct}%` }}
        />
        {/* baseline median tick */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-muted-foreground/70"
          style={{ left: `${geometry.medianPct}%` }}
        />
        {/* recent median dot, clamped into the track */}
        <span
          aria-hidden="true"
          data-testid={`range-gauge-dot-${row.metric}`}
          className={cn(
            "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
            row.severity === "alert"
              ? "bg-alert"
              : row.severity === "notable"
                ? "bg-notable"
                : "bg-accent",
          )}
          style={{ left: `${geometry.dotPct}%` }}
        />
      </div>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
        {unitLabel
          ? copy.pages.changes.usualBand(rangeText, unitLabel)
          : copy.pages.changes.usualBand(rangeText, "")}
      </span>
    </div>
  );
}
