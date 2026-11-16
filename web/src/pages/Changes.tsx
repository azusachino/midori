import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, CircleDashed } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { FindingRowDTO } from "@/api/types";
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
  groupChangesRows,
  isNotableDaytime,
  nextLook,
  rankFindingRows,
  sharedFlaggedChecks,
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
  const groups = groupChangesRows(overnightRows);
  const standsOutCount = groups.standsOut.length + daytimeRows.length;
  const withinCount = overnightRows.filter(
    (r) => r.state === "computed" && r.severity === "within",
  ).length;
  const otherCount = overnightRows.filter((r) => r.state !== "computed").length;
  const sharedNouns = sharedFlaggedChecks(overnightRows).map(
    (key) => copy.pages.changes.checkNouns[key] ?? key,
  );
  const look = changes.asOfDay ? nextLook(changes.asOfDay, new Date()) : null;

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

      {/* One-line answer (B-F12) */}
      <div
        data-testid="changes-answer"
        className="rounded-lg border border-border bg-card px-5 py-4"
      >
        <p className="text-lg font-medium text-foreground">
          {standsOutCount > 0
            ? copy.pages.changes.answerSome(standsOutCount)
            : copy.pages.changes.answerNone}
        </p>
        {overnightRows.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {copy.pages.changes.answerDetail(withinCount, otherCount)}
          </p>
        ) : null}
        {sharedNouns.length > 0 ? (
          <p data-testid="shared-checks" className="mt-2 text-sm text-foreground/80">
            {copy.pages.changes.sharedChecks(sharedNouns)}
          </p>
        ) : null}
      </div>

      {/* Overnight findings in B-F12 groups; the full ranked set stays one click away (B-F7) */}
      <section
        aria-labelledby={overnightHeadingId}
        data-testid="overnight-section"
        className="space-y-3"
      >
        <h2 id={overnightHeadingId} className="sr-only">
          {copy.pages.changes.overnightTitle}
        </h2>

        {overnightRows.length === 0 ? (
          <p
            data-testid="overnight-empty"
            className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground"
          >
            {copy.pages.changes.emptyOvernight}
          </p>
        ) : null}

        {groups.standsOut.length > 0 ? (
          <RowGroup
            testId="stands-out-group"
            title={copy.pages.changes.standsOutTitle}
            hint={copy.pages.changes.rankedHint}
            rows={groups.standsOut}
          />
        ) : null}

        {groups.closeToEdge.length > 0 ? (
          <RowGroup
            testId="close-to-edge-group"
            title={copy.pages.changes.closeToEdgeTitle}
            hint={copy.pages.changes.closeToEdgeHint}
            rows={groups.closeToEdge}
            footer={
              <p data-testid="watch-hint" className="px-1 text-xs text-muted-foreground">
                {copy.pages.changes.watchHint}
                {look && changes.asOfDay ? (
                  <>
                    {" "}
                    {look.due
                      ? copy.pages.changes.nextLookDue(formatShortDay(changes.asOfDay))
                      : copy.pages.changes.nextLookSoon(formatShortDay(look.day))}
                  </>
                ) : null}
              </p>
            }
          />
        ) : null}

        {groups.rest.length > 0 ? (
          <details data-testid="overnight-all" className="group/all">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-open/all:rotate-90"
              />
              <span className="group-open/all:hidden">
                {groups.rest.length === overnightRows.length
                  ? copy.pages.changes.showAll(overnightRows.length)
                  : copy.pages.changes.showMore(groups.rest.length)}
              </span>
              <span className="hidden group-open/all:inline">{copy.pages.changes.hideAll}</span>
            </summary>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
              {groups.rest.map((row) => (
                <FindingRow key={row.metric} row={row} />
              ))}
            </div>
          </details>
        ) : null}
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

function RowGroup({
  testId,
  title,
  hint,
  rows,
  footer,
}: {
  testId: string;
  title: string;
  hint: string;
  rows: readonly FindingRowDTO[];
  footer?: ReactNode;
}) {
  return (
    <div data-testid={testId} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <FindingRow key={row.metric} row={row} />
        ))}
      </div>
      {footer}
    </div>
  );
}
