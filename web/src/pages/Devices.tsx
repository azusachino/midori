import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { apiClient } from "@/api/client";
import type { EpochCardDTO, EpochsDTO } from "@/api/types";
import { DeviceTimeline } from "@/components/DeviceTimeline";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { copy } from "@/copy";
import {
  formatBaselineLabel,
  formatEpochSpan,
  formatOsUpdateLabel,
  formatSeamDescription,
  organizeEpochs,
  sortEpochMetrics,
} from "@/lib/devices";
import { epochDisplayLabel } from "@/lib/finding-format";
import { EPOCH_PALETTE, epochColor } from "@/lib/theme";
import { useAsyncQuery } from "@/lib/useAsyncQuery";
import { cn } from "@/lib/utils";

function resolveSeamColumnHeading(
  epoch: EpochCardDTO,
  epochById: Map<number, EpochCardDTO>,
): { heading: string; sharedFromEpochId: number | null } {
  const fromIds = new Set<number>();
  for (const m of epoch.metrics) {
    if (m.seamFromPrevious) fromIds.add(m.seamFromPrevious.fromEpochId);
  }
  if (fromIds.size === 1) {
    const onlyId = Array.from(fromIds)[0];
    if (onlyId !== undefined) {
      const targetEpoch = epochById.get(onlyId);
      if (targetEpoch) {
        return {
          heading: copy.pages.devices.columns.seamFrom(epochDisplayLabel(targetEpoch)),
          sharedFromEpochId: onlyId,
        };
      }
    }
  }
  return { heading: copy.pages.devices.columns.seam, sharedFromEpochId: null };
}

export function DevicesPage() {
  const query = useAsyncQuery<EpochsDTO>((signal) => apiClient.epochs(signal), "devices");
  const [showOccasional, setShowOccasional] = useState(false);
  const handleToggleOccasional = useCallback(() => {
    setShowOccasional((prev) => !prev);
  }, []);

  const organized = useMemo(
    () => (query.status === "ready" ? organizeEpochs(query.data) : null),
    [query],
  );

  if (query.status === "loading") {
    return <LoadingState variant="cards" count={3} />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.devicesTitle} message={query.error} onRetry={query.retry} />
    );
  }

  if (!query.data.hasImports || !organized) {
    return <EmptyState />;
  }

  const { primaryEpochs, minorEpochs, epochById, isSingleEpoch } = organized;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.devices.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.devices.subtitle}</p>
      </div>

      <DeviceTimeline epochs={query.data.epochs} />

      <div data-testid="epoch-cards-list" className="space-y-4">
        {primaryEpochs.map((epoch, idx) => {
          const recordedMetrics = epoch.metrics.filter(
            (m) =>
              !(m.role === "minor" && m.baselineState === "insufficient" && !m.seamFromPrevious),
          );
          const sortedMetrics = sortEpochMetrics(recordedMetrics);
          const displayLabel = epochDisplayLabel(epoch);
          const color = epochColor(epoch.colorIndex ?? idx);
          const isWrapped = idx >= EPOCH_PALETTE.length;
          const metaPrefix =
            epoch.deviceHw && epoch.deviceHw !== displayLabel
              ? epoch.deviceHw
              : epoch.sourceName && epoch.sourceName !== displayLabel
                ? epoch.sourceName
                : copy.pages.devices.kinds[epoch.kind];
          const spanSummary = formatEpochSpan(
            epoch.firstDay,
            epoch.lastDay,
            query.data.asOfDay,
            epoch.daysPresentCount,
          );
          const { heading: seamHeading, sharedFromEpochId } = resolveSeamColumnHeading(
            epoch,
            epochById,
          );

          return (
            <Card key={epoch.id} data-testid={`epoch-card-${epoch.id}`} className="min-w-0">
              <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5 sm:items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full sm:mt-0",
                      isWrapped ? "ring-1 ring-border-strong ring-offset-1 ring-offset-card" : "",
                    )}
                    style={{ backgroundColor: color }}
                  />
                  <div>
                    <CardTitle className="text-base">{displayLabel}</CardTitle>
                    <CardDescription className="tabular-nums">
                      {metaPrefix} · {spanSummary}
                    </CardDescription>
                  </div>
                </div>
                {epoch.primaryMetricCount > 0 ? (
                  <Badge variant="accent" className="w-fit shrink-0">
                    {copy.pages.devices.primaryFor(epoch.primaryMetricCount)}
                  </Badge>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-3">
                {sortedMetrics.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{copy.pages.devices.columns.metric}</TableHead>
                          <TableHead>{copy.pages.devices.columns.baseline}</TableHead>
                          {!isSingleEpoch ? (
                            <TableHead className="hidden sm:table-cell">{seamHeading}</TableHead>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedMetrics.map((row) => {
                          const metricName = copy.metrics[row.metric] ?? row.metric;
                          const baselineText = formatBaselineLabel(row);
                          const seam = row.seamFromPrevious;
                          const fromEpoch =
                            seam && seam.fromEpochId !== sharedFromEpochId
                              ? epochById.get(seam.fromEpochId)
                              : undefined;
                          const fromLabel = fromEpoch ? epochDisplayLabel(fromEpoch) : undefined;
                          const seamText = seam
                            ? formatSeamDescription(row.metric, seam, fromLabel)
                            : "—";

                          return (
                            <TableRow key={row.metric}>
                              <TableCell className="font-medium whitespace-nowrap">
                                <Link
                                  to="/metrics/$key"
                                  params={{ key: row.metric }}
                                  search={{ range: "180d", tab: "chart" }}
                                  className="text-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                  {metricName}
                                </Link>
                                {row.role !== "primary" ? (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    ({copy.pages.devices.roles[row.role]})
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "tabular-nums",
                                  row.baselineState === "warming_up"
                                    ? "text-learning"
                                    : row.baselineState === "insufficient" ||
                                        row.baselineState === "trend_only"
                                      ? "text-muted-foreground"
                                      : "text-foreground",
                                )}
                              >
                                <div className="whitespace-nowrap">{baselineText}</div>
                                {!isSingleEpoch && seam ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground whitespace-normal sm:hidden">
                                    {seamText}
                                  </div>
                                ) : null}
                              </TableCell>
                              {!isSingleEpoch ? (
                                <TableCell
                                  className={cn(
                                    "hidden tabular-nums sm:table-cell",
                                    seam ? "text-foreground" : "text-muted-foreground",
                                  )}
                                >
                                  {seamText}
                                </TableCell>
                              ) : null}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : epoch.osUpdates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {copy.pages.devices.noMetricsNote}
                  </p>
                ) : null}

                {epoch.osUpdates.length > 0 ? (
                  <div
                    data-testid={`epoch-os-updates-${epoch.id}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-2.5 text-xs text-muted-foreground tabular-nums"
                  >
                    <span className="font-medium text-foreground">
                      {copy.pages.devices.osUpdatesLabel}
                    </span>
                    <span>{epoch.osUpdates.map((ev) => formatOsUpdateLabel(ev)).join(" · ")}</span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {minorEpochs.length > 0 ? (
        <Card data-testid="occasional-sources-card">
          <button
            type="button"
            data-testid="occasional-sources-toggle"
            aria-expanded={showOccasional}
            onClick={handleToggleOccasional}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-minor"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  {copy.pages.devices.occasionalTitle(minorEpochs.length)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {copy.pages.devices.occasionalHint}
                </div>
              </div>
            </div>
            {showOccasional ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>

          {showOccasional ? (
            <CardContent
              data-testid="occasional-sources-list"
              className="divide-y divide-border border-t border-border pt-0"
            >
              {minorEpochs.map((minor) => {
                const minorLabel = epochDisplayLabel(minor);
                const minorMeta =
                  minor.deviceHw && minor.deviceHw !== minorLabel
                    ? minor.deviceHw
                    : copy.pages.devices.kinds[minor.kind];
                return (
                  <div
                    key={minor.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <div>
                      <span className="font-medium text-foreground">{minorLabel}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {minorMeta} ·{" "}
                        {formatEpochSpan(
                          minor.firstDay,
                          minor.lastDay,
                          query.data.asOfDay,
                          minor.daysPresentCount,
                        )}
                      </span>
                    </div>
                    <Badge variant="secondary">{copy.pages.devices.roles.minor}</Badge>
                  </div>
                );
              })}
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
