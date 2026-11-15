import type {
  DeviationDTO,
  LegacyFindingDTO as FindingDTO,
  MetricDailyDTO,
} from "@midori/domain/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApiClient } from "../api/client";
import { Chart } from "../components/Chart";
import type { ChartSeries } from "../components/chartData";
import { valueFmt } from "../components/chartData";
import { PageSection } from "../components/PageSection";
import { copy } from "../copy";
import "../styles/investigate.css";

/**
 * Investigate (T19): pick a metric, see its per-source daily series with the baseline
 * band and device seams, the baseline check table, and device events. The HRV family
 * (SDNN/RMSSD) renders both series side by side — never blended — with the seam marked.
 */

const METRIC_KEYS = Object.keys(copy.metrics) as (keyof typeof copy.metrics)[];
const HRV_FAMILY = new Set(["hrv_sdnn", "hrv_rmssd"]);

function metricParam(): string {
  const params = new URLSearchParams(window.location.search);
  const metric = params.get("metric");
  return metric !== null && METRIC_KEYS.includes(metric as keyof typeof copy.metrics)
    ? metric
    : "sleep_h";
}

type Phase = "loading" | "ready" | "error";

export function InvestigatePage() {
  const [metric, setMetric] = useState<string>(metricParam);
  const [phase, setPhase] = useState<Phase>("loading");
  const [seriesByMetric, setSeriesByMetric] = useState<Record<string, MetricDailyDTO[]>>({});
  const [deviations, setDeviations] = useState<DeviationDTO[]>([]);
  const [findings, setFindings] = useState<FindingDTO[]>([]);

  const load = useCallback(
    (signal?: AbortSignal) => {
      const client = createApiClient();
      setPhase("loading");
      const metricsToLoad = HRV_FAMILY.has(metric) ? ["hrv_sdnn", "hrv_rmssd"] : [metric];
      Promise.all([
        Promise.all(
          metricsToLoad.map((m) =>
            client
              .metricDaily(m, signal)
              .then((rows) => ({ m, rows }))
              .catch(() => ({ m, rows: [] as MetricDailyDTO[] })),
          ),
        ),
        client.deviations(undefined, signal).catch(() => [] as DeviationDTO[]),
        client.findings(signal).catch(() => [] as FindingDTO[]),
      ])
        .then(([night, devs, finds]) => {
          const map: Record<string, MetricDailyDTO[]> = {};
          for (const { m, rows } of night) map[m] = rows;
          setSeriesByMetric(map);
          setDeviations(devs);
          setFindings(finds);
          setPhase("ready");
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.kind === "aborted") return;
          setPhase("error");
        });
    },
    [metric],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const retry = useCallback(() => {
    load();
  }, [load]);

  const onPickChange = useCallback((e: { target: { value: string } }) => {
    const next = e.target.value;
    setMetric(next);
    const params = new URLSearchParams(window.location.search);
    params.set("metric", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  const metricFindings = findings.filter((f) => f.metric === metric);
  const boundaryDays = [...new Set(metricFindings.map((f) => f.anchorDay).filter((d) => d !== ""))];
  const metricDeviations = deviations.filter((d) => d.metric === metric);

  return (
    <PageSection title={copy.pages.investigate.title}>
      <label className="investigate__picker">
        {copy.investigate.metricLabel}
        <select value={metric} onChange={onPickChange}>
          {METRIC_KEYS.map((m) => (
            <option key={m} value={m}>
              {copy.metrics[m]}
            </option>
          ))}
        </select>
      </label>
      {phase === "loading" ? <p className="muted">…</p> : null}
      {phase === "error" ? (
        <p className="muted">
          {copy.investigate.loadError}{" "}
          <button type="button" className="btn" onClick={retry}>
            {copy.investigate.retry}
          </button>
        </p>
      ) : null}
      {phase === "ready" ? (
        <MetricView
          metric={metric}
          seriesByMetric={seriesByMetric}
          deviations={metricDeviations}
          findings={metricFindings}
          boundaryDays={boundaryDays}
        />
      ) : null}
    </PageSection>
  );
}

interface MetricViewProps {
  metric: string;
  seriesByMetric: Record<string, MetricDailyDTO[]>;
  deviations: DeviationDTO[];
  findings: FindingDTO[];
  boundaryDays: string[];
}

function MetricView({
  metric,
  seriesByMetric,
  deviations,
  findings,
  boundaryDays,
}: MetricViewProps) {
  const metricsToDraw = HRV_FAMILY.has(metric) ? ["hrv_sdnn", "hrv_rmssd"] : [metric];
  const label = copy.metrics[metric as keyof typeof copy.metrics] ?? metric;

  const chartSeries: ChartSeries[] = useMemo(() => {
    const out: ChartSeries[] = [];
    for (const m of metricsToDraw) {
      const rows = seriesByMetric[m] ?? [];
      for (const row of rows) {
        const mLabel = copy.metrics[m as keyof typeof copy.metrics] ?? m;
        out.push({
          label: metricsToDraw.length > 1 ? `${row.sourceName} · ${mLabel}` : row.sourceName,
          points: row.points.map((p) => ({ day: p.day, value: p.value })),
          band: null,
        });
      }
    }
    return out;
  }, [metricsToDraw, seriesByMetric]);

  // Attach the baseline band to the series that owns the freshest deviation row.
  const bandedSeries: ChartSeries[] = useMemo(() => {
    if (chartSeries.length === 0) return chartSeries;
    const lastSource = chartSeries[chartSeries.length - 1]?.label.split(" · ")[0] ?? "";
    const withBand = deviations.find(
      (d) => d.sourceName === lastSource && d.baselineLow !== null && d.baselineHigh !== null,
    );
    const lo = withBand?.baselineLow ?? null;
    const hi = withBand?.baselineHigh ?? null;
    if (withBand === undefined || lo === null || hi === null) return chartSeries;
    return chartSeries.map((s, i) =>
      i === chartSeries.length - 1 ? { ...s, band: { low: lo, high: hi } } : s,
    );
  }, [chartSeries, deviations]);

  const primary = metricsToDraw[0] ?? metric;
  const unit = (seriesByMetric[primary] ?? [])[0]?.unit ?? null;

  return (
    <>
      <h2>{copy.investigate.chartTitle(label)}</h2>
      {chartSeries.length === 0 ? (
        <p className="muted">{copy.investigate.noData}</p>
      ) : (
        <>
          {metricsToDraw.length > 1 ? (
            <p className="muted">{copy.investigate.hrvPairNote}</p>
          ) : null}
          <Chart series={bandedSeries} boundaryDays={boundaryDays} unit={unit} height={300} />
          <p className="muted">{copy.investigate.bandNote}</p>
        </>
      )}

      <h2>{copy.investigate.deviationsTitle}</h2>
      {deviations.length === 0 ? (
        <p className="muted">{copy.investigate.noDeviations}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{copy.investigate.sourceLabel}</th>
              <th>{copy.investigate.baselineCol}</th>
              <th>{copy.investigate.recentCol}</th>
              <th>{copy.investigate.zCol}</th>
            </tr>
          </thead>
          <tbody>
            {deviations.map((d) => (
              <tr key={`${d.metric}:${d.sourceName}`}>
                <td>{d.sourceName}</td>
                <td className="num">{d.baseline === null ? "—" : valueFmt(d.baseline)}</td>
                <td className="num">{d.recent === null ? "—" : valueFmt(d.recent)}</td>
                <td className="num">
                  {d.suppressed !== null
                    ? copy.briefing.suppressed[d.suppressed]
                    : d.z === null
                      ? "—"
                      : `${d.z.toFixed(1)}σ`}{" "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{copy.investigate.eventsTitle}</h2>
      {findings.length === 0 ? (
        <p className="muted">{copy.investigate.noEvents}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{copy.investigate.whenCol}</th>
              <th>{copy.investigate.whatCol}</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={`${f.kind}:${f.metric}:${f.sourceName}:${f.anchorDay}`}>
                <td className="num">{f.anchorDay}</td>
                <td>
                  {f.kind === "recalibration"
                    ? `${f.sourceName} began recording ${label.toLowerCase()} near another source`
                    : f.kind === "coverage"
                      ? `coverage boundary after ${f.sourceName}`
                      : `${f.sourceName} deviates (${f.severity})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
