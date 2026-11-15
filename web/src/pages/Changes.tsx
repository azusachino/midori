import { Link } from "@tanstack/react-router";
import type { EChartsCoreOption } from "echarts/core";
import { useCallback, useId } from "react";
import { EChart } from "@/components/EChart";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { useShell } from "@/lib/shell-context";
import { type ChartTheme, epochColor } from "@/lib/theme";

export function ChangesPage() {
  const headingId = useId();
  const { status, changes, errorMessage, refresh } = useShell();

  const tempFinding = changes?.overnight.find((r) => r.metric === "wrist_temp") ?? null;
  const sparkPoints = tempFinding?.sparkline ?? [];

  const buildSmokeOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const color = epochColor(1, theme.epochs);
      return {
        grid: { left: 44, right: 16, top: 16, bottom: 28 },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.foreground, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: sparkPoints.map((p) => p.day),
          axisLine: { lineStyle: { color: theme.borderStrong } },
          axisLabel: { color: theme.mutedForeground, fontSize: 11 },
        },
        yAxis: {
          type: "value",
          scale: true,
          splitLine: { lineStyle: { color: theme.border } },
          axisLabel: { color: theme.mutedForeground, fontSize: 11 },
        },
        series: [
          {
            name: copy.metrics.wrist_temp,
            type: "line",
            connectNulls: false,
            showSymbol: true,
            symbolSize: 5,
            lineStyle: { color, width: 2 },
            itemStyle: { color },
            data: sparkPoints.map((p) => p.value),
          },
        ],
      };
    },
    [sparkPoints],
  );

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.changes.title}</h1>
        {changes.asOfDay ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {copy.pages.changes.asOf(changes.asOfDay)}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{copy.pages.changes.placeholderNote}</p>

      {sparkPoints.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle>{copy.pages.changes.smokePreviewTitle}</CardTitle>
              <CardDescription>
                {copy.chart.smokeSummary(
                  copy.metrics.wrist_temp ?? "wrist_temp",
                  sparkPoints.length,
                )}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/metrics/$key"
                params={{ key: "wrist_temp" }}
                search={{ range: "90d", tab: "chart" }}
              >
                {copy.pages.changes.openMetric}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <EChart
              data-testid="echart-smoke"
              height={180}
              buildOption={buildSmokeOption}
              summary={copy.chart.smokeSummary(
                copy.metrics.wrist_temp ?? "wrist_temp",
                sparkPoints.length,
              )}
              table={{
                columns: [
                  { key: "day", label: copy.chart.dayCol },
                  { key: "value", label: copy.chart.valueCol },
                ],
                rows: sparkPoints.map((p) => ({ day: p.day, value: p.value })),
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby={headingId} className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-sm font-medium text-foreground">
            {copy.pages.changes.overnightTitle}
          </h2>
          <span className="text-xs text-muted-foreground">{copy.pages.changes.rankedHint}</span>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {changes.overnight.map((row) => (
            <Link
              key={row.metric}
              to="/metrics/$key"
              params={{ key: row.metric }}
              search={{ range: "90d", tab: "chart" }}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm no-underline hover:bg-muted/40 transition-colors"
            >
              <span className="font-medium text-foreground">
                {copy.metrics[row.metric] ?? row.metric}
              </span>
              <div className="flex items-center gap-2">
                {row.warmup ? (
                  <Badge variant="learning" className="tabular-nums">
                    {copy.sidebar.learningProgress(row.warmup.current, row.warmup.target)}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{row.state}</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
