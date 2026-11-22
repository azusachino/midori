import { METRICS } from "@midori/domain/metrics";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type MouseEvent, useCallback, useRef } from "react";
import { apiClient } from "@/api/client";
import type { MetricRange, MetricSeriesDTO, MetricTab } from "@/api/types";
import { ChecksPanel } from "@/components/ChecksPanel";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import { FindingRow } from "@/components/FindingRow";
import { LoadingState } from "@/components/LoadingState";
import { LongViewCalendar } from "@/components/LongViewCalendar";
import { MetricChart } from "@/components/MetricChart";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy } from "@/copy";
import { displayUnit, unitNounFor } from "@/lib/finding-format";
import { buildBaselineSummary, buildRecentUnitRows, nextWiderRange } from "@/lib/metric-chart";
import { isKnownMetric, OVERNIGHT_ORDER } from "@/lib/metrics";
import { useShell } from "@/lib/shell-context";
import { useAsyncQuery } from "@/lib/useAsyncQuery";
import { cn } from "@/lib/utils";

const RANGES: readonly MetricRange[] = ["90d", "180d", "1y", "all"];

export function MetricDetailPage() {
  const { key } = useParams({ from: "/metrics/$key" });
  const search = useSearch({ from: "/metrics/$key" });
  const navigate = useNavigate({ from: "/metrics/$key" });
  const shell = useShell();
  const evidenceTriggerRef = useRef<HTMLElement | null>(null);

  const known = isKnownMetric(key);
  const seriesRange: MetricRange = search.tab === "long" ? "1y" : search.range;

  const query = useAsyncQuery<MetricSeriesDTO>((signal) => {
    if (!known) return Promise.reject(new Error(copy.pages.metricDetail.unknownBody(key)));
    return apiClient.metricSeries(key, seriesRange, signal);
  }, `${key}:${seriesRange}`);

  const handleTabChange = useCallback(
    (next: string) => {
      const tab: MetricTab = next === "long" ? "long" : "chart";
      void navigate({ search: (prev) => ({ ...prev, tab }) });
    },
    [navigate],
  );

  const handleRangeClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const next = event.currentTarget.dataset.range as MetricRange | undefined;
      if (!next) return;
      void navigate({
        search: (prev) => {
          const updated = { ...prev, range: next };
          delete updated.zoomStart;
          delete updated.zoomEnd;
          return updated;
        },
      });
    },
    [navigate],
  );

  const handleZoomChange = useCallback(
    (zoom: { zoomStart: string; zoomEnd: string } | null) => {
      void navigate({
        replace: true,
        search: (prev) => {
          if (!zoom) {
            if (!prev.zoomStart && !prev.zoomEnd) return prev;
            const updated = { ...prev };
            delete updated.zoomStart;
            delete updated.zoomEnd;
            return updated;
          }
          if (prev.zoomStart === zoom.zoomStart && prev.zoomEnd === zoom.zoomEnd) {
            return prev;
          }
          return { ...prev, zoomStart: zoom.zoomStart, zoomEnd: zoom.zoomEnd };
        },
      });
    },
    [navigate],
  );

  const handleResetZoom = useCallback(() => {
    void navigate({
      replace: true,
      search: (prev) => {
        const updated = { ...prev };
        delete updated.zoomStart;
        delete updated.zoomEnd;
        return updated;
      },
    });
  }, [navigate]);

  const handleSelectDay = useCallback(
    (day: string, trigger?: HTMLElement) => {
      if (trigger) {
        evidenceTriggerRef.current = trigger;
      } else if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      ) {
        evidenceTriggerRef.current = document.activeElement;
      }
      void navigate({
        search: (prev) => ({ ...prev, night: day }),
      });
    },
    [navigate],
  );

  const handleNotesChanged = useCallback(() => {
    query.retry();
    shell.refresh();
  }, [query, shell]);

  const handleCloseEvidence = useCallback(() => {
    void navigate({
      replace: true,
      search: (prev) => {
        if (!prev.night) return prev;
        const updated = { ...prev };
        delete updated.night;
        return updated;
      },
    });
  }, [navigate]);

  const handleRowButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const day = event.currentTarget.dataset.day;
      if (day) handleSelectDay(day, event.currentTarget);
    },
    [handleSelectDay],
  );

  if (!known) {
    const knownKeys = Array.from(new Set([...OVERNIGHT_ORDER, ...Object.keys(METRICS)]));
    return (
      <Card data-testid="unknown-metric">
        <CardHeader>
          <CardTitle>{copy.pages.metricDetail.unknownTitle}</CardTitle>
          <CardDescription>{copy.pages.metricDetail.unknownBody(key)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {copy.pages.metricDetail.knownListLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {knownKeys.map((k) => (
              <Button key={k} variant="outline" size="sm" asChild>
                <Link
                  to="/metrics/$key"
                  params={{ key: k }}
                  search={{ range: "180d", tab: "chart" }}
                >
                  {copy.metrics[k] ?? k}
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (shell.status === "ready" && shell.changes && !shell.changes.hasImports) {
    return <EmptyState />;
  }

  if (query.status === "loading") {
    return <LoadingState variant="chart" />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.metricDetailTitle} message={query.error} onRetry={query.retry} />
    );
  }

  const data = query.data;
  if (data.asOfDay === null && data.units.length === 0 && shell.status === "loading") {
    return <LoadingState variant="chart" />;
  }
  const label = copy.metrics[data.metric] ?? data.metric;
  const unitDisplay = displayUnit(data.metric, data.unit) || data.unit;
  const noun = unitNounFor(data.kind);
  const recentRows = buildRecentUnitRows(data, 7);
  const baselineSummary = buildBaselineSummary(data);
  const widerRange = nextWiderRange(search.range);
  const isZoomed = Boolean(search.zoomStart && search.zoomEnd);
  const hasDetailSections =
    data.units.length > 0 || (data.finding !== null && data.finding.sparkline.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft aria-hidden="true" />
              {copy.pages.metricDetail.backToChanges}
            </Link>
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{label}</h1>
          {unitDisplay ? (
            <span className="text-sm text-muted-foreground">{unitDisplay}</span>
          ) : null}
          <Badge variant="secondary">{copy.trust[data.trust]}</Badge>
        </div>

        <Tabs value={search.tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="chart">{copy.pages.metricDetail.tabs.chart}</TabsTrigger>
            <TabsTrigger value="long">{copy.pages.metricDetail.tabs.long}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {data.kind === "trendOnly" ? (
        <div
          data-testid="trend-only-note"
          className="rounded-md border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground"
        >
          {copy.pages.metricDetail.trendOnlyNote}
        </div>
      ) : data.finding ? (
        <Card className="overflow-hidden">
          <FindingRow row={data.finding} mode="header" />
        </Card>
      ) : null}

      <Tabs value={search.tab} className="min-w-0">
        <TabsContent value="chart" className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <fieldset
              aria-label={copy.pages.metricDetail.rangeGroupLabel}
              className="m-0 inline-flex items-center gap-1 rounded-md border border-border bg-card p-1"
            >
              {RANGES.map((r) => (
                <Button
                  key={r}
                  data-range={r}
                  aria-pressed={search.range === r}
                  variant={search.range === r ? "secondary" : "ghost"}
                  size="sm"
                  onClick={handleRangeClick}
                >
                  {copy.pages.metricDetail.ranges[r]}
                </Button>
              ))}
            </fieldset>

            {isZoomed ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="reset-zoom-btn"
                onClick={handleResetZoom}
              >
                {copy.pages.metricDetail.resetZoom}
              </Button>
            ) : null}
          </div>

          {data.units.length === 0 ? (
            <Card data-testid="empty-range-state">
              <CardHeader>
                <CardTitle className="text-base">
                  {copy.pages.metricDetail.emptyRange(noun)}
                </CardTitle>
                <CardDescription>{copy.pages.metricDetail.ranges[search.range]}</CardDescription>
              </CardHeader>
              {widerRange ? (
                <CardContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-range={widerRange}
                    data-testid="widen-range-btn"
                    onClick={handleRangeClick}
                  >
                    {copy.pages.metricDetail.widenRangeCta(
                      copy.pages.metricDetail.ranges[widerRange],
                    )}
                  </Button>
                </CardContent>
              ) : null}
            </Card>
          ) : (
            <Card className="min-w-0 overflow-hidden">
              <CardContent className="pt-4">
                <MetricChart
                  series={data}
                  zoomStart={search.zoomStart}
                  zoomEnd={search.zoomEnd}
                  onZoomChange={handleZoomChange}
                  onSelectDay={handleSelectDay}
                />
              </CardContent>
            </Card>
          )}

          {hasDetailSections ? (
            <div
              className={cn(
                "grid min-w-0 gap-5",
                data.kind !== "trendOnly" ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "",
              )}
            >
              {data.kind !== "trendOnly" ? (
                <ChecksPanel series={data} onSelectDay={handleSelectDay} />
              ) : null}

              <Card data-testid="recent-units-card" className="min-w-0 overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    {copy.pages.metricDetail.recentUnitsTitle(noun)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <Table data-testid="recent-units-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 sm:px-3">
                          {copy.pages.metricDetail.recentTable.colDay}
                        </TableHead>
                        <TableHead className="px-2 sm:px-3">
                          {copy.pages.metricDetail.recentTable.colValue}
                        </TableHead>
                        <TableHead className="px-2 sm:px-3">
                          {copy.pages.metricDetail.recentTable.colZ}
                        </TableHead>
                        <TableHead className="hidden px-2 sm:table-cell sm:px-3">
                          {copy.pages.metricDetail.recentTable.colDevice}
                        </TableHead>
                        <TableHead className="px-2 sm:px-3">
                          {copy.pages.metricDetail.recentTable.colNotes}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentRows.map((row) => (
                        <TableRow
                          key={`${row.day}-${row.deviceLabel}`}
                          data-usable={row.usable ? "true" : "false"}
                          data-selected={search.night === row.day ? "true" : undefined}
                          className={cn(
                            search.night === row.day && "bg-muted/40",
                            !row.usable && "bg-muted/20 text-muted-foreground opacity-75",
                          )}
                        >
                          <TableCell className="px-2 tabular-nums sm:px-3">
                            <button
                              type="button"
                              data-day={row.day}
                              data-testid={`recent-row-btn-${row.day}`}
                              onClick={handleRowButtonClick}
                              className={cn(
                                "text-left font-medium underline decoration-border-strong underline-offset-4 hover:text-primary hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring cursor-pointer tabular-nums",
                                row.usable ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {row.dayLabel}
                            </button>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-2 tabular-nums sm:px-3",
                              row.usable ? "font-medium" : "text-muted-foreground",
                            )}
                          >
                            {row.valueText}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-2 tabular-nums sm:px-3",
                              row.zTone === "alert" && "text-alert font-medium",
                              row.zTone === "notable" && "text-notable font-medium",
                              (row.zTone === "within" || row.zTone === "none") &&
                                "text-muted-foreground",
                            )}
                          >
                            {row.zText}
                          </TableCell>
                          <TableCell className="hidden px-2 text-muted-foreground sm:table-cell sm:px-3">
                            {row.deviceLabel}
                          </TableCell>
                          <TableCell className="px-2 text-xs whitespace-normal text-muted-foreground sm:px-3">
                            {[row.partialNote, row.tzChange ? copy.chart.tzShiftNote : null]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <p
                    data-testid="baseline-summary"
                    className="border-t border-border pt-3 text-xs text-muted-foreground tabular-nums"
                  >
                    {baselineSummary}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="long">
          <Card className="min-w-0 overflow-hidden">
            <CardContent className="pt-4">
              <LongViewCalendar series={data} onSelectDay={handleSelectDay} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EvidenceSheet
        metric={data.metric}
        unit={data.unit}
        kind={data.kind}
        day={search.night ?? null}
        returnFocusTo={evidenceTriggerRef}
        onClose={handleCloseEvidence}
        onNotesChanged={handleNotesChanged}
      />
    </div>
  );
}
