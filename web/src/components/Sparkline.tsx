import { useId } from "react";
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
  return "text-muted-foreground";
}

/**
 * Closes one recent-segment polyline down to `bottom`, so each contiguous run fills as
 * its own area and a `null` gap never draws a twisted polygon across the break.
 */
function closeAreaPath(segment: string, bottom: number): string {
  const vertices = [...segment.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)];
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (!first || !last) return segment;
  return `${segment} L${last[1]},${bottom} L${first[1]},${bottom} Z`;
}

export function Sparkline({
  metricLabel,
  points,
  baselineLow,
  baselineHigh,
  severity,
  className,
}: SparklineProps) {
  // Every instance needs its own gradient id: the bento, the grouped rows and a
  // collapsed details list all render sparklines in one document (H2).
  const gradientId = useId();

  if (points.length === 0) return null;

  const geo = buildSparklineGeometry(points, baselineLow, baselineHigh);
  const accentClass = accentColorClass(severity);
  const areaBottom = geo.height - 3;
  const areaPaths = geo.recentSegments.map((d) => closeAreaPath(d, areaBottom));
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
      className={cn("shrink-0 overflow-visible", accentClass, className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
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

      {areaPaths.map((d) => (
        <path key={`area-${d}`} d={d} fill={`url(#${gradientId})`} stroke="none" />
      ))}

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
