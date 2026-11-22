import { Check, Copy } from "lucide-react";
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { apiClient } from "@/api/client";
import type { MetricKind, UnitEvidenceDTO } from "@/api/types";
import { NotesPanel } from "@/components/NotesPanel";
import { ReadError } from "@/components/ReadError";
import { SleepStageBar } from "@/components/SleepStageBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/copy";
import {
  formatEvidenceHeading,
  formatEvidencePartialReason,
  formatEvidenceSummaryLine,
  formatEvidenceValue,
} from "@/lib/evidence";
import { useAsyncQuery } from "@/lib/useAsyncQuery";

export interface EvidenceSheetProps {
  metric: string;
  unit: string;
  kind: MetricKind;
  day: string | null;
  returnFocusTo?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Called after a note mutation so the parent can refetch checks/charts. */
  onNotesChanged?: () => void;
}

/**
 * Right-hand (full-screen on <768 px) unit evidence drawer wired to ?night=YYYY-MM-DD.
 */
export function EvidenceSheet({
  metric,
  unit,
  kind,
  day,
  returnFocusTo,
  onClose,
  onNotesChanged,
}: EvidenceSheetProps) {
  const unitKind: UnitEvidenceDTO["unitKind"] = kind === "daytime" ? "day" : "night";
  const evCopy = copy.pages.metricDetail.evidence;
  const heading = day ? formatEvidenceHeading(unitKind, day, metric) : "";

  const fallbackFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (day && !wasOpenRef.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        fallbackFocusRef.current = active;
      }
      wasOpenRef.current = true;
      return;
    }
    if (!day && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = returnFocusTo?.current ?? fallbackFocusRef.current;
      fallbackFocusRef.current = null;
      if (target?.isConnected) {
        queueMicrotask(() => target.focus());
      }
    }
  }, [day, returnFocusTo]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      const target = returnFocusTo?.current ?? fallbackFocusRef.current;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
      }
    },
    [returnFocusTo],
  );

  return (
    <Sheet open={Boolean(day)} onOpenChange={handleOpenChange}>
      <SheetContent
        data-testid="evidence-sheet"
        closeLabel={evCopy.closeLabel}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <SheetHeader>
          <SheetTitle data-testid="evidence-sheet-title">{heading}</SheetTitle>
          <SheetDescription className="sr-only">{evCopy.sheetDescription}</SheetDescription>
        </SheetHeader>

        {day ? (
          <EvidenceLoader
            metric={metric}
            unit={unit}
            day={day}
            {...(onNotesChanged ? { onNotesChanged } : {})}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface EvidenceLoaderProps {
  metric: string;
  unit: string;
  day: string;
  onNotesChanged?: () => void;
}

function EvidenceLoader({ metric, unit, day, onNotesChanged }: EvidenceLoaderProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const evCopy = copy.pages.metricDetail.evidence;

  const query = useAsyncQuery<UnitEvidenceDTO>(
    (signal) => apiClient.unitEvidence(metric, day, signal),
    `${metric}:${day}`,
  );

  useEffect(() => {
    void day;
    setCopied(false);
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, [day]);

  const handleCopyLink = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Clipboard API may be blocked in unprivileged frames; still show copied confirmation.
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, []);

  if (query.status === "loading") {
    return (
      <div data-testid="evidence-loading" className="space-y-4">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-24 w-full" />
        <span className="sr-only">{evCopy.loadingLabel}</span>
      </div>
    );
  }

  if (query.status === "error") {
    return <ReadError title={evCopy.loadError} message={query.error} onRetry={query.retry} />;
  }

  const handleNotesChanged = () => {
    query.retry();
    onNotesChanged?.();
  };

  return (
    <EvidenceBody
      evidence={query.data}
      unit={unit}
      copied={copied}
      onCopyLink={handleCopyLink}
      onNotesChanged={handleNotesChanged}
    />
  );
}

interface EvidenceBodyProps {
  evidence: UnitEvidenceDTO;
  unit: string;
  copied: boolean;
  onCopyLink: () => void;
  onNotesChanged: () => void;
}

function EvidenceBody({ evidence, unit, copied, onCopyLink, onNotesChanged }: EvidenceBodyProps) {
  const samplesHeadingId = useId();
  const sleepHeadingId = useId();
  const notesHeadingId = useId();
  const evCopy = copy.pages.metricDetail.evidence;
  const partialReasonText = formatEvidencePartialReason(evidence.partialReason);
  const hasSamples =
    evidence.samples.length > 0 || evidence.sampleCount > 0 || evidence.value !== null;

  return (
    <div data-testid="evidence-sheet-body" className="flex flex-1 flex-col gap-5 text-sm">
      <div className="space-y-2 border-b border-border pb-4">
        <p data-testid="evidence-summary-line" className="font-medium text-foreground tabular-nums">
          {formatEvidenceSummaryLine(evidence, unit)}
        </p>

        {hasSamples
          ? (() => {
              const primaryLabel = evidence.primaryEpoch
                ? evidence.primaryEpoch.label
                : evCopy.unknownDevice;
              const metaParts = evidence.primaryEpoch
                ? [
                    evidence.primaryEpoch.deviceHw || null,
                    evidence.deviceSw ? `OS ${evidence.deviceSw}` : null,
                  ].filter((part): part is string => part !== null)
                : [];
              return (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{evCopy.devicePrefix}</span>
                  <span className="font-medium text-foreground">{primaryLabel}</span>
                  {metaParts.length > 0 ? <span>({metaParts.join(" · ")})</span> : null}
                  <Badge
                    variant="secondary"
                    data-testid="evidence-usability-badge"
                    className={evidence.usable ? undefined : "text-partial"}
                  >
                    {evidence.usable ? evCopy.usableLabel : evCopy.partialLabel(partialReasonText)}
                  </Badge>
                </div>
              );
            })()
          : null}
      </div>

      {evidence.samples.length > 0 ? (
        <section aria-labelledby={samplesHeadingId} className="space-y-2">
          <h3
            id={samplesHeadingId}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {evCopy.samplesHeading}
          </h3>
          <div
            data-testid="evidence-samples-list"
            className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background/50 p-3 sm:grid-cols-3"
          >
            {(() => {
              const seenCounts = new Map<string, number>();
              return evidence.samples.map((s) => {
                const base = `${s.timestamp}-${s.value}`;
                const count = (seenCounts.get(base) ?? 0) + 1;
                seenCounts.set(base, count);
                return (
                  <div
                    key={`${base}-${count}`}
                    className="flex items-baseline justify-between gap-2 rounded bg-card/80 px-2 py-1 text-xs tabular-nums"
                  >
                    <span className="font-mono text-muted-foreground">{s.localTime}</span>
                    <span className="font-medium text-foreground">
                      {formatEvidenceValue(s.value, evidence.metric, unit)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </section>
      ) : null}

      {evidence.sleep ? (
        <section aria-labelledby={sleepHeadingId} className="space-y-2">
          <h3
            id={sleepHeadingId}
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {evCopy.sleepHeading}
          </h3>
          <div
            data-testid="evidence-sleep-panel"
            className="space-y-2.5 rounded-md border border-border bg-background/50 p-3"
          >
            <p className="text-xs text-foreground tabular-nums">
              {evCopy.sleepWindow(
                evidence.sleep.startLocal,
                evidence.sleep.endLocal,
                evidence.sleep.asleepH.toFixed(1),
              )}
            </p>
            <SleepStageBar
              deepH={evidence.sleep.deepH}
              remH={evidence.sleep.remH}
              coreH={evidence.sleep.coreH}
            />
          </div>
        </section>
      ) : null}

      {evidence.alsoRecordedBy.length > 0 ? (
        <p data-testid="evidence-also-recorded" className="text-xs text-muted-foreground">
          {evCopy.alsoRecordedBy}{" "}
          <span className="text-foreground">
            {evidence.alsoRecordedBy.map((e) => e.label).join(", ")}
          </span>
        </p>
      ) : null}

      <section aria-labelledby={notesHeadingId} className="space-y-2">
        <h3
          id={notesHeadingId}
          className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          {copy.notes.heading}
        </h3>
        <NotesPanel
          notes={evidence.notes}
          defaultDay={evidence.day}
          compact
          onChanged={onNotesChanged}
          testId="evidence-notes"
        />
      </section>

      <div className="mt-auto border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="evidence-copy-link-btn"
          onClick={onCopyLink}
          className="gap-1.5"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{evCopy.copiedLink}</span>
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{evCopy.copyLink}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
