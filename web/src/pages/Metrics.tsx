import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { apiClient } from "@/api/client";
import type {
  EpochsDTO,
  FindingRowDTO,
  FindingSeverity,
  MetricIndexEntryDTO,
  MetricKind,
  MetricsIndexDTO,
} from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { MetricMiniChart } from "@/components/MetricMiniChart";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { displayUnit, formatRecentVsBaseline, unitNounFor } from "@/lib/finding-format";
import { useAsyncQuery } from "@/lib/useAsyncQuery";
import { cn } from "@/lib/utils";

const KIND_GROUPS: readonly MetricKind[] = ["overnight", "daytime", "trendOnly"];

function barTintClass(severity: FindingSeverity | undefined): string {
  if (severity === "alert") return "bg-alert";
  if (severity === "notable") return "bg-notable";
  return "bg-transparent";
}

function directionTintClass(severity: FindingSeverity): string {
  if (severity === "alert") return "text-alert font-medium";
  if (severity === "notable") return "text-notable font-medium";
  return "text-muted-foreground";
}

function CompactFindingLine({ entry }: { entry: MetricIndexEntryDTO }) {
  if (!entry.hasData) {
    return null;
  }

  if (entry.kind === "trendOnly" || !entry.finding) {
    return <p className="text-xs text-muted-foreground">{copy.pages.metrics.trendOnlySummary}</p>;
  }

  const row: FindingRowDTO = entry.finding;
  const noun = unitNounFor(row.kind);

  if (row.state === "warming_up" && row.warmup) {
    return (
      <p className="text-xs text-learning tabular-nums">
        {copy.pages.changes.learningRow(row.warmup.current, row.warmup.target, noun)}
      </p>
    );
  }

  if (row.state === "insufficient") {
    return (
      <p className="text-xs text-muted-foreground tabular-nums">
        {copy.pages.changes.insufficientRow(row.recentCount, noun)}
      </p>
    );
  }

  if (row.state === "stale") {
    return <p className="text-xs text-muted-foreground">{copy.pages.changes.staleRow(noun)}</p>;
  }

  const values = formatRecentVsBaseline(row);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      {row.direction ? (
        <span className={directionTintClass(row.severity)}>{copy.direction[row.direction]}</span>
      ) : null}
      {values ? <span className="text-foreground tabular-nums">{values}</span> : null}
      {row.kOutside !== null ? (
        <span className="text-muted-foreground tabular-nums">
          {copy.pages.changes.frequency(row.kOutside, row.recentCount, noun)}
        </span>
      ) : null}
    </div>
  );
}

interface MetricsPageData {
  index: MetricsIndexDTO;
  epochs: EpochsDTO | null;
}

/** Metrics index (/metrics): ordered groups, compact status, and 1-year weekly mini charts. */
export function MetricsPage() {
  const query = useAsyncQuery<MetricsPageData>(async (signal) => {
    const [index, epochs] = await Promise.all([
      apiClient.metricsIndex(signal),
      apiClient.epochs(signal).catch(() => null),
    ]);
    return { index, epochs };
  }, "metrics");

  const epochLabels = useMemo(() => {
    const map = new Map<number, string>();
    if (query.status === "ready" && query.data.epochs) {
      for (const ep of query.data.epochs.epochs) {
        map.set(ep.id, ep.label);
      }
    }
    return map;
  }, [query]);

  if (query.status === "loading") {
    return <LoadingState variant="cards" count={6} />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.metricsTitle} message={query.error} onRetry={query.retry} />
    );
  }

  if (!query.data.index.hasImports) {
    return <EmptyState />;
  }

  return (
    <div data-testid="metrics-index-page" className="space-y-7">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.metrics.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.metrics.subtitle}</p>
      </div>

      {KIND_GROUPS.map((kind) => {
        const items = query.data.index.metrics.filter((m) => m.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} data-testid={`metrics-group-${kind}`} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {copy.pages.metrics.groups[kind]}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {items.map((item) => {
                const label = copy.metrics[item.metric] ?? item.metric;
                const unitLabel = displayUnit(item.metric, item.unit) || item.unit;
                return (
                  <Card
                    key={item.metric}
                    data-testid={`metric-card-${item.metric}`}
                    className="relative flex h-full overflow-hidden transition-colors hover:border-border-strong"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "w-[3px] shrink-0 self-stretch",
                        item.hasData ? barTintClass(item.finding?.severity) : "bg-transparent",
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <CardHeader className="space-y-1.5 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="flex flex-wrap items-baseline gap-1.5 text-sm">
                            <Link
                              to="/metrics/$key"
                              params={{ key: item.metric }}
                              search={{ range: "180d", tab: "chart" }}
                              className="text-foreground no-underline after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                            >
                              {label}
                            </Link>
                            {unitLabel ? (
                              <span className="text-xs font-normal text-muted-foreground">
                                {unitLabel}
                              </span>
                            ) : null}
                          </CardTitle>
                          <Badge variant="secondary" className="shrink-0">
                            {copy.trust[item.trust]}
                          </Badge>
                        </div>
                        <CompactFindingLine entry={item} />
                      </CardHeader>
                      <CardContent className="mt-auto pt-1">
                        {item.hasData && item.weeklySeries.length > 0 ? (
                          <MetricMiniChart entry={item} epochLabels={epochLabels} />
                        ) : (
                          <div
                            data-testid={`metric-no-data-${item.metric}`}
                            className="flex h-[112px] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                          >
                            {copy.pages.metrics.noDataYet}
                          </div>
                        )}
                      </CardContent>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
