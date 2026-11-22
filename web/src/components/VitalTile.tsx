import { Link } from "@tanstack/react-router";
import { Flag } from "lucide-react";
import type { FindingRowDTO } from "@/api/types";
import { MetricIcon } from "@/components/MetricIcon";
import { RangeGauge } from "@/components/RangeGauge";
import { Sparkline } from "@/components/Sparkline";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/copy";
import { flaggedChecksFor, unitNounFor } from "@/lib/finding-format";
import { cn } from "@/lib/utils";
import { selectVitalRows, splitVitalReading, vitalStatus } from "@/lib/vitals";

function glowClass(row: FindingRowDTO): string {
  if (row.severity === "alert") return "midori-glow-alert";
  if (row.severity === "notable") return "midori-glow-notable";
  return "";
}

function pillVariant(row: FindingRowDTO): "secondary" | "notable" | "alert" | "learning" {
  const status = vitalStatus(row);
  if (status === "learning") return "learning";
  if (status === "within" || status === "noRecent") return "secondary";
  if (row.severity === "alert") return "alert";
  return "notable";
}

/**
 * One Apple-Vitals-style bento tile for a core overnight metric (v5 plan §3). The
 * whole tile is the link to the metric chart, so every inner element stays
 * non-interactive: no buttons, popovers, or row test ids from `FindingRow`.
 */
export function VitalTile({ row }: { row: FindingRowDTO }) {
  const label = copy.metrics[row.metric] ?? row.metric;
  const reading = splitVitalReading(row);
  const status = vitalStatus(row);
  const flagged = flaggedChecksFor(row);
  const noun = unitNounFor(row.kind);
  const warmupPct =
    row.warmup && row.warmup.target > 0
      ? Math.max(0, Math.min(100, Math.round((row.warmup.current / row.warmup.target) * 100)))
      : 0;

  return (
    <Link
      to="/metrics/$key"
      params={{ key: row.metric }}
      search={{ range: "90d", tab: "chart" }}
      data-testid={`vital-tile-${row.metric}`}
      data-severity={row.severity}
      data-state={row.state}
      aria-label={copy.pages.changes.vitalsBento.openMetricAria(label)}
      className={cn(
        "midori-tile midori-tile-interactive flex min-w-0 flex-col gap-3 p-4 no-underline",
        glowClass(row),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground"
          >
            <MetricIcon metric={row.metric} size={14} />
          </span>
          <span className="truncate text-xs font-medium text-foreground">{label}</span>
        </div>
        <Badge variant={pillVariant(row)} className="shrink-0">
          {copy.pages.changes.vitalsBento.status[status]}
        </Badge>
      </div>

      {row.state === "warming_up" && row.warmup ? (
        <div className="space-y-1.5">
          <p className="text-xs text-learning tabular-nums">
            {copy.pages.changes.learningRow(row.warmup.current, row.warmup.target, noun)}
          </p>
          <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-learning"
              style={{ width: `${warmupPct}%` }}
            />
          </div>
        </div>
      ) : reading ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-3xl">
            {reading.value}
          </span>
          {reading.unit ? (
            <span className="text-xs font-medium text-muted-foreground">{reading.unit}</span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground tabular-nums">
          {row.state === "stale"
            ? copy.pages.changes.staleRow(noun)
            : copy.pages.changes.insufficientRow(row.recentCount, noun)}
        </p>
      )}

      <RangeGauge row={row} layout="stacked" testId={`vital-gauge-${row.metric}`} />

      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.state === "computed" && row.kOutside !== null ? (
            <span className="whitespace-nowrap tabular-nums">
              {copy.pages.changes.frequency(row.kOutside, row.recentCount, noun)}
            </span>
          ) : null}
          {flagged.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-notable/40 bg-notable/10 px-1.5 py-0.5 text-notable tabular-nums">
              <Flag aria-hidden="true" className="h-3 w-3" />
              {copy.pages.changes.vitalsBento.flaggedChecks(flagged.length)}
            </span>
          ) : null}
        </div>
        <Sparkline
          metricLabel={label}
          points={row.sparkline}
          baselineLow={row.baselineLow}
          baselineHigh={row.baselineHigh}
          severity={row.severity}
        />
      </div>
    </Link>
  );
}

/**
 * Always-visible bento grid of the six core overnight vitals. Rendered outside
 * `overnight-section` so the grouped `finding-row-*` list keeps its own semantics.
 */
export function VitalsBento({ rows }: { rows: readonly FindingRowDTO[] }) {
  const tiles = selectVitalRows(rows);
  if (tiles.length === 0) return null;

  return (
    <section
      data-testid="vitals-bento"
      aria-label={copy.pages.changes.vitalsBento.title}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="midori-kicker">{copy.pages.changes.vitalsBento.title}</p>
        <span className="text-xs text-muted-foreground">{copy.pages.changes.vitalsBento.hint}</span>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((row) => (
          <VitalTile key={row.metric} row={row} />
        ))}
      </div>
    </section>
  );
}
