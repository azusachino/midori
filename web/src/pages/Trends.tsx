import { useMemo, useState } from "react";
import { apiClient } from "@/api/client";
import type { HealthContextDTO } from "@/api/types";
import { CorrelatedVitalsChart } from "@/components/CorrelatedVitalsChart";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { SleepArchitectureChart } from "@/components/SleepArchitectureChart";
import { copy } from "@/copy";
import { buildTrendsData, type TrendsRangeDays } from "@/lib/trends";
import { useAsyncQuery } from "@/lib/useAsyncQuery";
import { cn } from "@/lib/utils";

const RANGES: readonly TrendsRangeDays[] = [14, 30];

/**
 * B-T1: multi-metric graphs over `GET /api/context?days=`. Lazy-loaded so ECharts stays
 * out of the entry bundle; the dossier is the same one agents read, so the page adds no
 * backend query.
 */
export function TrendsPage() {
  const [days, setDays] = useState<TrendsRangeDays>(14);
  const query = useAsyncQuery<HealthContextDTO>(
    (signal) => apiClient.context(days, signal),
    `trends:${days}`,
  );
  const rangeLabel = copy.pages.trends.ranges[days === 14 ? "14d" : "30d"];

  const data = useMemo(
    () => (query.status === "ready" ? buildTrendsData(query.data) : null),
    [query.status, query.data],
  );

  if (query.status === "loading") {
    return <LoadingState variant="cards" count={2} />;
  }

  if (query.status === "error") {
    return <ReadError title={copy.error.trendsTitle} message={query.error} onRetry={query.retry} />;
  }

  if (query.data.asOfDay === null) {
    return <EmptyState />;
  }

  return (
    <div data-testid="trends-page" className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.trends.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.pages.trends.subtitle}</p>
        </div>
        <fieldset
          aria-label={copy.pages.trends.rangeLabel}
          className="m-0 inline-flex overflow-hidden rounded-md border border-border p-0"
        >
          {RANGES.map((range) => {
            const active = range === days;
            return (
              <button
                key={range}
                type="button"
                aria-pressed={active}
                data-testid={`trends-range-${range}d`}
                onClick={() => setDays(range)}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {copy.pages.trends.ranges[range === 14 ? "14d" : "30d"]}
              </button>
            );
          })}
        </fieldset>
      </div>

      {data === null || data.nights.length === 0 ? (
        <p
          data-testid="trends-empty"
          className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground"
        >
          {copy.pages.trends.empty}
        </p>
      ) : (
        <div className="space-y-4">
          <SleepArchitectureChart data={data} rangeLabel={rangeLabel} />
          <CorrelatedVitalsChart data={data} rangeLabel={rangeLabel} />
        </div>
      )}
    </div>
  );
}
