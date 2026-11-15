import { METRICS } from "@midori/domain/metrics";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { EChartsCoreOption } from "echarts/core";
import { ArrowLeft } from "lucide-react";
import { type MouseEvent, useCallback } from "react";
import { apiClient } from "@/api/client";
import { OVERNIGHT_ORDER } from "@/api/fixtures";
import type { MetricRange, MetricSeriesDTO, MetricTab } from "@/api/types";
import { EChart } from "@/components/EChart";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy } from "@/copy";
import { type ChartTheme, epochColor } from "@/lib/theme";
import { useAsyncQuery } from "@/lib/useAsyncQuery";

const RANGES: readonly MetricRange[] = ["90d", "180d", "1y", "all"];

function isKnownMetricKey(key: string): boolean {
  return key in METRICS || (OVERNIGHT_ORDER as readonly string[]).includes(key);
}

export function MetricDetailPage() {
  const { key } = useParams({ from: "/metrics/$key" });
  const search = useSearch({ from: "/metrics/$key" });
  const navigate = useNavigate({ from: "/metrics/$key" });

  const known = isKnownMetricKey(key);

  const query = useAsyncQuery<MetricSeriesDTO>((signal) => {
    if (!known) return Promise.reject(new Error(copy.pages.metricDetail.unknownBody(key)));
    return apiClient.metricSeries(key, search.range, signal);
  }, `${key}:${search.range}`);

  const units = query.status === "ready" ? query.data.units : [];
  const epochs = query.status === "ready" ? query.data.epochs : [];
  const unitLabel = query.status === "ready" ? query.data.unit : "";

  const buildOption = useCallback(
    (theme: ChartTheme): EChartsCoreOption => {
      const series = epochs.map((epoch, idx) => {
        const color = epoch.minor ? theme.minor : epochColor(epoch.colorIndex ?? idx, theme.epochs);
        const data = units.map((u) => (u.epochId === epoch.id ? u.value : null));
        return {
          name: epoch.label,
          type: "line" as const,
          connectNulls: false,
          showSymbol: true,
          symbolSize: epoch.minor ? 4 : 6,
          lineStyle: { color, width: epoch.minor ? 1 : 1.5 },
          itemStyle: { color },
          data,
        };
      });

      return {
        grid: { left: 48, right: 20, top: 24, bottom: 32 },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.card,
          borderColor: theme.borderStrong,
          textStyle: { color: theme.foreground, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: units.map((u) => u.day),
          axisLine: { lineStyle: { color: theme.borderStrong } },
          axisLabel: { color: theme.mutedForeground, fontSize: 11 },
        },
        yAxis: {
          type: "value",
          name: unitLabel,
          nameTextStyle: { color: theme.mutedForeground, fontSize: 11 },
          scale: true,
          splitLine: { lineStyle: { color: theme.border } },
          axisLabel: { color: theme.mutedForeground, fontSize: 11 },
        },
        series,
      };
    },
    [epochs, units, unitLabel],
  );

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
      void navigate({ search: (prev) => ({ ...prev, range: next }) });
    },
    [navigate],
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

  if (query.status === "loading") {
    return <LoadingState variant="chart" />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.metricDetailTitle} message={query.error} onRetry={query.retry} />
    );
  }

  const data = query.data;
  const label = copy.metrics[data.metric] ?? data.metric;

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
          {data.unit ? <span className="text-sm text-muted-foreground">{data.unit}</span> : null}
          <Badge variant="secondary">{copy.trust[data.trust]}</Badge>
        </div>

        <Tabs value={search.tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="chart">{copy.pages.metricDetail.tabs.chart}</TabsTrigger>
            <TabsTrigger value="long">{copy.pages.metricDetail.tabs.long}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="text-xs text-muted-foreground">{copy.pages.metricDetail.placeholderNote}</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              data-range={r}
              variant={search.range === r ? "secondary" : "ghost"}
              size="sm"
              onClick={handleRangeClick}
            >
              {copy.pages.metricDetail.ranges[r]}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {data.epochs.map((epoch, idx) => (
            <span key={epoch.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: epoch.minor ? undefined : epochColor(epoch.colorIndex ?? idx),
                }}
              />
              <span>{epoch.label}</span>
            </span>
          ))}
        </div>
      </div>

      <Tabs value={search.tab}>
        <TabsContent value="chart">
          <Card>
            <CardContent className="pt-4">
              <EChart
                data-testid="metric-echart"
                height={260}
                buildOption={buildOption}
                summary={copy.chart.smokeSummary(label, data.units.length)}
                table={{
                  columns: [
                    { key: "day", label: copy.chart.dayCol },
                    { key: "value", label: copy.chart.valueCol },
                    { key: "usable", label: copy.chart.usableCol },
                  ],
                  rows: data.units.map((u) => ({
                    day: u.day,
                    value: u.value,
                    usable: u.usable,
                  })),
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="long">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{copy.pages.metricDetail.tabs.long}</CardTitle>
              <CardDescription>{copy.pages.metricDetail.placeholderNote}</CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
