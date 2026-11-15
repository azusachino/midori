import type { FindingSeverity, SparklinePointDTO } from "@/api/types";
import { copy } from "@/copy";
import { buildSparklineGeometry } from "@/lib/finding-format";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  metricLabel: string;
  points: readonly SparklinePointDTO[];
  baselineLow: number | null;
  baselineHigh: number | null;
  severity: FindingSeverity;
  className?: string;
}

function accentColorClass(severity: FindingSeverity): string {
  if (severity === "alert") return "text-alert";
  if (severity === "notable") return "text-notable";
  return "text-accent";
}

export function Sparkline({
  metricLabel,
  points,
  baselineLow,
  baselineHigh,
  severity,
  className,
}: SparklineProps) {
  if (points.length === 0) return null;

  const geo = buildSparklineGeometry(points, baselineLow, baselineHigh);
  const accentClass = accentColorClass(severity);
  const clippedPoints = geo.points.filter((p) => p.clipped !== null);
  const partialPoints = geo.points.filter((p) => !p.usable && p.clipped === null);
  const recentEnd = [...geo.points].reverse().find((p) => p.isRecent && p.usable);

  return (
    <svg
      role="img"
      aria-label={copy.pages.changes.sparklineAria(metricLabel, points.length, geo.hasClipped)}
      data-testid="sparkline"
      data-clipped={geo.hasClipped ? "true" : undefined}
      width={geo.width}
      height={geo.height}
      viewBox={`0 0 ${geo.width} ${geo.height}`}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {geo.bandRect ? (
        <rect
          x={2}
          y={geo.bandRect.y}
          width={geo.width - 4}
          height={geo.bandRect.height}
          rx={1}
          className="fill-muted/70"
        />
      ) : null}

      {geo.recentSplitX !== null ? (
        <line
          x1={geo.recentSplitX}
          y1={1}
          x2={geo.recentSplitX}
          y2={geo.height - 1}
          stroke="currentColor"
          strokeDasharray="2 2"
          strokeWidth={0.75}
          className="text-border-strong"
        />
      ) : null}

      {geo.baselineSegments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground/75"
        />
      ))}

      {geo.recentSegments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={accentClass}
        />
      ))}

      {partialPoints.map((pt) => (
        <circle
          key={`${pt.x}-${pt.y}-partial`}
          cx={pt.x}
          cy={pt.y}
          r={1.75}
          stroke="currentColor"
          strokeWidth={1.25}
          className={cn("fill-card", pt.isRecent ? accentClass : "text-muted-foreground")}
        />
      ))}

      {recentEnd ? (
        <circle
          cx={recentEnd.x}
          cy={recentEnd.y}
          r={2}
          className={cn("fill-current", accentClass)}
        />
      ) : null}

      {clippedPoints.map((pt) => {
        const tipY = pt.clipped === "high" ? pt.y - 2 : pt.y + 2;
        const baseY = pt.clipped === "high" ? pt.y + 2.2 : pt.y - 2.2;
        return (
          <polygon
            key={`${pt.x}-${pt.y}-clip`}
            points={`${pt.x},${tipY} ${pt.x - 2.4},${baseY} ${pt.x + 2.4},${baseY}`}
            className={cn("fill-current", accentClass)}
          />
        );
      })}
    </svg>
  );
}
