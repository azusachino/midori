import { Link } from "@tanstack/react-router";
import { AlertTriangle, CircleDashed } from "lucide-react";
import { useId } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FindingRow } from "@/components/FindingRow";
import { LastNightCard } from "@/components/LastNightCard";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { copy } from "@/copy";
import {
  formatDayWithWeekday,
  formatRangeSpan,
  formatShortDay,
  isAllWithin,
  isNotableDaytime,
  rankFindingRows,
} from "@/lib/finding-format";
import { useShell } from "@/lib/shell-context";

export function ChangesPage() {
  const overnightHeadingId = useId();
  const daytimeHeadingId = useId();
  const { status, changes, errorMessage, refresh } = useShell();

  if (status === "loading") {
    return <LoadingState variant="rows" count={6} />;
  }

  if (status === "error") {
    return (
      <ReadError
        title={copy.error.changesTitle}
        message={errorMessage ?? copy.api.unknownError}
        onRetry={refresh}
      />
    );
  }

  if (!changes?.hasImports) {
    return <EmptyState />;
  }

  const overnightRows = rankFindingRows(changes.overnight);
  const daytimeRows = rankFindingRows(changes.daytime.filter(isNotableDaytime));
  const allWithin = isAllWithin(overnightRows, daytimeRows);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.changes.title}</h1>
        {changes.asOfDay ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {copy.pages.changes.asOf(formatDayWithWeekday(changes.asOfDay))}
          </p>
        ) : null}
      </div>

      {/* Stale import banner (B-R2, >30 days since import) */}
      {changes.staleBanner ? (
        <Alert variant="warning" data-testid="stale-import-banner">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <AlertDescription className="mt-0 text-foreground">
              {copy.pages.changes.staleBanner(
                changes.staleBanner.daysSinceImport,
                formatRangeSpan(changes.staleBanner.windowFrom, changes.staleBanner.windowTo),
              )}
            </AlertDescription>
            <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
              <Link to="/import">{copy.pages.changes.staleImportCta}</Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* New-watch warming-up notice (J3) */}
      {changes.warmingNotice ? (
        <Alert variant="learning" data-testid="warming-notice">
          <CircleDashed aria-hidden="true" className="h-4 w-4" />
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <AlertDescription className="mt-0 text-foreground">
              {copy.pages.changes.warmingNotice(
                copy.metrics[changes.warmingNotice.metric] ?? changes.warmingNotice.metric,
                changes.warmingNotice.current,
                changes.warmingNotice.target,
                changes.warmingNotice.estimatedReadyDay
                  ? formatShortDay(changes.warmingNotice.estimatedReadyDay)
                  : null,
              )}
            </AlertDescription>
            <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
              <Link to="/devices">{copy.pages.changes.devicesCta}</Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* Overnight findings (always full overnight set, B-F7) */}
      <section
        aria-labelledby={overnightHeadingId}
        data-testid="overnight-section"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 id={overnightHeadingId} className="text-sm font-medium text-foreground">
              {copy.pages.changes.overnightTitle}
            </h2>
            {allWithin ? (
              <span data-testid="all-within-banner" className="text-xs text-muted-foreground">
                {copy.pages.changes.allWithin(overnightRows.length)}
              </span>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">{copy.pages.changes.rankedHint}</span>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {overnightRows.length > 0 ? (
            overnightRows.map((row) => <FindingRow key={row.metric} row={row} />)
          ) : (
            <p
              data-testid="overnight-empty"
              className="px-4 py-6 text-center text-sm text-muted-foreground"
            >
              {copy.pages.changes.emptyOvernight}
            </p>
          )}
        </div>
      </section>

      {/* Daytime findings — shown only when notable or alert (B-F7) */}
      {daytimeRows.length > 0 ? (
        <section
          aria-labelledby={daytimeHeadingId}
          data-testid="daytime-section"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={daytimeHeadingId} className="text-sm font-medium text-foreground">
              {copy.pages.changes.daytimeTitle}
            </h2>
            <span className="text-xs text-muted-foreground">{copy.pages.changes.daytimeHint}</span>
          </div>

          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {daytimeRows.map((row) => (
              <FindingRow key={row.metric} row={row} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Last complete night card (B-R3) */}
      <LastNightCard lastNight={changes.lastNight} />
    </div>
  );
}
