import type {
  BriefingDTO,
  DeviationDTO,
  LegacyFindingDTO as FindingDTO,
  MetricDailyDTO,
} from "@midori/domain/api";
import { useCallback, useEffect, useState } from "react";
import { ApiError, createApiClient } from "../api/client";
import { valueFmt } from "../components/chartData";
import { PageSection } from "../components/PageSection";
import { copy } from "../copy";
import "../styles/briefing.css";

/**
 * Briefing (T18): the product's front page. Answer "how am I doing" in one glance:
 * as-of date, last-night cards, ranked deviations with evidence links, device-change
 * notices, import status + cadence nudge. Read-only; everything links to Investigate.
 */

const LAST_NIGHT: { metric: keyof typeof copy.metrics; unit: string }[] = [
  { metric: "sleep_h", unit: "h" },
  { metric: "deep_h", unit: "h" },
  { metric: "rem_h", unit: "h" },
  { metric: "rhr", unit: "bpm" },
  { metric: "hrv_sdnn", unit: "ms" },
  { metric: "resp_rate", unit: "/min" },
];

interface NightCard {
  metric: string;
  label: string;
  value: number | null;
  unit: string;
  day: string | null;
  trust: "high" | "moderate" | "low";
  trustNote: string;
}

type Phase = "loading" | "ready" | "error";

export function BriefingPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [briefing, setBriefing] = useState<BriefingDTO | null>(null);
  const [deviations, setDeviations] = useState<DeviationDTO[]>([]);
  const [cards, setCards] = useState<NightCard[]>([]);

  const load = useCallback((signal?: AbortSignal) => {
    const client = createApiClient();
    setPhase("loading");
    Promise.all([
      client.briefing(signal),
      client.deviations(undefined, signal),
      Promise.all(
        LAST_NIGHT.map(({ metric }) =>
          client
            .metricDaily(metric, signal)
            .then((rows: MetricDailyDTO[]) => ({ metric, rows }))
            .catch(() => ({ metric, rows: [] as MetricDailyDTO[] })),
        ),
      ),
    ])
      .then(([b, devs, night]) => {
        setBriefing(b);
        setDeviations(devs);
        setCards(
          LAST_NIGHT.map(({ metric, unit }) => {
            const entry = night.find((n) => n.metric === metric);
            // rows are per-source; the card shows the freshest source's last point
            const freshest = entry?.rows.reduce<MetricDailyDTO | undefined>(
              (acc, r) => (acc === undefined || r.asOfDay > acc.asOfDay ? r : acc),
              undefined,
            );
            return {
              metric,
              label: copy.metrics[metric],
              value: freshest ? (freshest.points.at(-1)?.value ?? null) : null,
              unit,
              day: freshest?.asOfDay ?? null,
              trust: freshest?.trust ?? "moderate",
              trustNote: freshest?.trustNote ?? "",
            };
          }),
        );
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.kind === "aborted") return;
        setPhase("error");
      });
  }, []);

  const retry = useCallback(() => {
    load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (phase === "loading") {
    return (
      <PageSection title={copy.pages.briefing.title}>
        <p className="muted">{copy.briefing.loading}</p>
      </PageSection>
    );
  }
  if (phase === "error" || briefing === null) {
    return (
      <PageSection title={copy.pages.briefing.title}>
        <p className="muted">{copy.briefing.loadError}</p>
        <button type="button" className="btn" onClick={retry}>
          {copy.briefing.retry}
        </button>
      </PageSection>
    );
  }

  const recalibrations = briefing.findings.filter((f) => f.kind === "recalibration");
  const coverage = briefing.findings.filter((f) => f.kind === "coverage");

  return (
    <>
      <PageSection title={copy.pages.briefing.title} lead={copy.briefing.asOf(briefing.anchorDay)}>
        <div className="briefing__import">
          {briefing.lastImport ? (
            <span className="muted">
              {copy.briefing.importLine(
                briefing.lastImport.zipName,
                copy.status[briefing.lastImport.status],
              )}
            </span>
          ) : null}
          {briefing.importCadenceHint ? (
            <span className="briefing__nudge">{briefing.importCadenceHint}</span>
          ) : null}
        </div>
        <h3>{copy.briefing.lastNightTitle}</h3>
        <ul className="cards">
          {cards.map((c) => (
            <li key={c.metric} className="card">
              <span className="card__label">{c.label}</span>
              <span className="card__value">
                {c.value === null ? (
                  <span className="muted">{copy.briefing.noData}</span>
                ) : (
                  <>
                    <span className="num">{valueFmt(c.value)}</span>{" "}
                    <span className="unit">{c.unit}</span>
                  </>
                )}
              </span>
              {c.day ? <span className="card__day muted">{copy.briefing.asOf(c.day)}</span> : null}
              <TrustChip trust={c.trust} note={c.trustNote} />
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection title={copy.briefing.deviationsTitle}>
        {deviations.length === 0 ? (
          <p className="muted">{copy.briefing.noDeviations}</p>
        ) : (
          <ul className="deviations">
            {deviations.map((d) => (
              <DeviationRow key={`${d.metric}:${d.sourceName}`} row={d} />
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title={copy.briefing.recalibrationTitle}>
        {recalibrations.length === 0 && coverage.length === 0 ? (
          <p className="muted">{copy.briefing.noFindings}</p>
        ) : (
          <ul className="findings">
            {recalibrations.map((f) => (
              <FindingRow key={`${f.kind}:${f.metric}:${f.sourceName}:${f.anchorDay}`} f={f} />
            ))}
            {coverage.map((f) => (
              <FindingRow key={`${f.kind}:${f.metric}:${f.sourceName}:${f.anchorDay}`} f={f} />
            ))}
          </ul>
        )}
      </PageSection>
    </>
  );
}

function TrustChip({ trust, note }: { trust: "high" | "moderate" | "low"; note: string }) {
  return (
    <span className={`chip chip--trust-${trust}`} title={note}>
      {copy.trust[trust]}
    </span>
  );
}

function SeverityChip({ severity }: { severity: "within" | "notable" | "alert" }) {
  return <span className={`chip chip--${severity}`}>{copy.severity[severity]}</span>;
}

function investigateHref(metric: string, source?: string): string {
  const params = new URLSearchParams({ metric });
  if (source) params.set("source", source);
  return `/investigate?${params.toString()}`;
}

function DeviationRow({ row }: { row: DeviationDTO }) {
  const label = copy.metrics[row.metric as keyof typeof copy.metrics] ?? row.metric;
  const suppressed = row.suppressed !== null;
  return (
    <li className={`deviation deviation--${suppressed ? "suppressed" : row.severity}`}>
      <div className="deviation__head">
        <SeverityChip severity={suppressed ? "within" : row.severity} />
        <span className="deviation__metric">{label}</span>
        <span className="muted">{row.sourceName}</span>
        <a className="deviation__link" href={investigateHref(row.metric, row.sourceName)}>
          {copy.briefing.evidenceLink}
        </a>
      </div>
      {suppressed ? (
        <p className="deviation__detail muted">
          {row.suppressed !== null ? copy.briefing.suppressed[row.suppressed] : ""}
          {row.baseline !== null && row.recent !== null
            ? ` — recent ${valueFmt(row.recent)} vs baseline ${valueFmt(row.baseline)}`
            : ""}
        </p>
      ) : (
        <p className="deviation__detail">
          recent <span className="num">{row.recent === null ? "—" : valueFmt(row.recent)}</span> vs
          baseline{" "}
          <span className="num">{row.baseline === null ? "—" : valueFmt(row.baseline)}</span>{" "}
          {row.unit ?? ""} —{" "}
          <span className="num">{row.z === null ? "" : `${row.z.toFixed(1)}σ`}</span>
        </p>
      )}
      <TrustChip trust={row.trust} note="" />
    </li>
  );
}

function FindingRow({ f }: { f: FindingDTO }) {
  const label = copy.metrics[f.metric as keyof typeof copy.metrics] ?? f.metric;
  const text =
    f.kind === "recalibration"
      ? `${f.sourceName} started recording ${label.toLowerCase()} on ${f.anchorDay}`
      : `${f.sourceName} has a coverage boundary on ${label.toLowerCase()} at ${f.anchorDay}`;
  return (
    <li className="finding">
      <span className="muted">{text}</span>
      <a className="finding__link" href={investigateHref(f.metric, f.sourceName)}>
        {copy.briefing.evidenceLink}
      </a>
    </li>
  );
}
