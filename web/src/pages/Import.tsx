import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Circle, Loader2, RotateCw, Upload } from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ApiError, apiClient, ImportFailedError } from "@/api/client";
import type { ImportDTO } from "@/api/types";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  formatDurationClock,
  formatDurationMs,
  formatMegabytes,
  IMPORT_STAGES,
  isActiveImportStatus,
  isBadExportMessage,
  resolveJobStage,
} from "@/lib/import-helpers";
import { useShell } from "@/lib/shell-context";
import { cn } from "@/lib/utils";

interface UploadProgressState {
  fileName: string;
  loaded: number;
  total: number;
}

export function ImportPage() {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const { changes, refresh: refreshShell } = useShell();

  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportDTO[]>([]);

  const [dragActive, setDragActive] = useState(false);
  const [uploadState, setUploadState] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<ImportDTO | null>(null);
  const [completedJob, setCompletedJob] = useState<ImportDTO | null>(null);
  const [failedJob, setFailedJob] = useState<ImportDTO | null>(null);
  const [retryExpiredIds, setRetryExpiredIds] = useState<Record<number, boolean>>({});
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const fetchImports = useCallback(async (signal?: AbortSignal): Promise<ImportDTO[]> => {
    const rows = await apiClient.imports(signal);
    setHistory(rows);
    return rows;
  }, []);

  const beginPolling = useCallback(
    (jobId: number, seedRow: ImportDTO | null, fromCurrentUpload: boolean) => {
      pollAbortRef.current?.abort();
      const ac = new AbortController();
      pollAbortRef.current = ac;

      if (seedRow) {
        setActiveJob(seedRow);
      } else {
        setActiveJob({
          id: jobId,
          zipName: "export.zip",
          zipSize: 0,
          status: "queued",
          stage: "queued",
          progress: null,
          error: null,
          exportVersion: null,
          recordsSeen: null,
          recordsInserted: null,
          recordsDeduped: null,
          durationMs: null,
          createdAt: new Date().toISOString(),
        });
      }
      setFailedJob(null);
      setCompletedJob(null);

      void apiClient
        .pollImport(jobId, {
          intervalMs: 400,
          signal: ac.signal,
          onUpdate: (row) => {
            setActiveJob(row);
          },
        })
        .then(async (doneRow) => {
          if (ac.signal.aborted) return;
          setActiveJob(null);
          setCompletedJob(doneRow);
          setUploadError(null);
          await fetchImports(ac.signal).catch(() => undefined);
          refreshShell();
        })
        .catch(async (err: unknown) => {
          if (ac.signal.aborted) return;
          if (err instanceof ApiError && err.kind === "aborted") return;
          setActiveJob(null);
          const rows = await fetchImports(ac.signal).catch(() => []);
          const row = rows.find((r) => r.id === jobId) ?? null;
          if (err instanceof ImportFailedError) {
            if (fromCurrentUpload && isBadExportMessage(err.reason)) {
              setUploadError(copy.pages.import.errors.notHealthExport);
              setFailedJob(null);
            } else {
              setFailedJob(
                row ?? {
                  id: jobId,
                  zipName: "export.zip",
                  zipSize: 0,
                  status: "failed",
                  error: err.reason,
                  exportVersion: null,
                  recordsSeen: null,
                  recordsInserted: null,
                  recordsDeduped: null,
                  durationMs: null,
                  createdAt: new Date().toISOString(),
                },
              );
            }
          } else {
            setUploadError(err instanceof Error ? err.message : copy.api.unknownError);
          }
          refreshShell();
        });
    },
    [fetchImports, refreshShell],
  );

  const loadInitial = useCallback(() => {
    const ac = new AbortController();
    setLoadPhase("loading");
    setLoadError(null);

    void fetchImports(ac.signal)
      .then((rows) => {
        if (ac.signal.aborted) return;
        setLoadPhase("ready");
        const active = rows.find((r) => isActiveImportStatus(r.status)) ?? null;
        if (active) {
          beginPolling(active.id, active, false);
        } else if (rows[0]?.status === "failed" && !isBadExportMessage(rows[0].error)) {
          setFailedJob(rows[0]);
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && err.kind === "aborted") return;
        setLoadError(err instanceof Error ? err.message : copy.api.unknownError);
        setLoadPhase("error");
      });

    return () => ac.abort();
  }, [beginPolling, fetchImports]);

  useEffect(() => {
    const cancelLoad = loadInitial();
    return () => {
      cancelLoad();
      pollAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
    };
  }, [loadInitial]);

  useEffect(() => {
    if (!activeJob) {
      setElapsedSeconds(0);
      return;
    }
    const startedMs = Date.parse(activeJob.createdAt);
    const updateClock = () => {
      const base = Number.isNaN(startedMs) ? Date.now() : startedMs;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [activeJob]);

  const startUpload = useCallback(
    async (file: File) => {
      if (uploadState !== null || activeJob !== null) return;

      uploadAbortRef.current?.abort();
      const ac = new AbortController();
      uploadAbortRef.current = ac;

      setUploadError(null);
      setCompletedJob(null);
      setFailedJob(null);
      setUploadState({ fileName: file.name, loaded: 0, total: file.size });

      try {
        const accepted = await apiClient.upload(file, {
          name: file.name,
          signal: ac.signal,
          onProgress: (loaded, total) => {
            setUploadState({ fileName: file.name, loaded, total });
          },
        });
        if (ac.signal.aborted) return;
        setUploadState(null);
        refreshShell();
        beginPolling(accepted.importId, null, true);
      } catch (err) {
        if (ac.signal.aborted) return;
        setUploadState(null);
        if (err instanceof ApiError) {
          if (err.kind === "network") {
            setUploadError(copy.pages.import.errors.uploadInterrupted);
            return;
          }
          if (err.status === 400 || err.status === 415 || isBadExportMessage(err.message)) {
            setUploadError(copy.pages.import.errors.notHealthExport);
            return;
          }
          if (err.status === 409) {
            setUploadError(copy.pages.import.errors.alreadyRunning);
            const rows = await fetchImports().catch(() => []);
            const active = rows.find((r) => isActiveImportStatus(r.status)) ?? null;
            if (active) beginPolling(active.id, active, false);
            return;
          }
          if (err.status === 413) {
            setUploadError(copy.pages.import.errors.uploadTooLarge);
            return;
          }
          setUploadError(err.message);
          return;
        }
        setUploadError(err instanceof Error ? err.message : copy.api.unknownError);
      }
    },
    [activeJob, beginPolling, fetchImports, refreshShell, uploadState],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void startUpload(file);
    },
    [startUpload],
  );

  const handleChooseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files[0];
      if (file) void startUpload(file);
    },
    [startUpload],
  );

  const triggerRetry = useCallback(
    async (id: number) => {
      setRetryingId(id);
      setUploadError(null);
      try {
        const accepted = await apiClient.retryImport(id);
        setRetryingId(null);
        beginPolling(accepted.importId, null, false);
      } catch (err) {
        setRetryingId(null);
        if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
          setRetryExpiredIds((prev) => ({ ...prev, [id]: true }));
          return;
        }
        setUploadError(err instanceof Error ? err.message : copy.api.unknownError);
      }
    },
    [beginPolling],
  );

  const handleRetryCardClick = useCallback(() => {
    if (!failedJob) return;
    void triggerRetry(failedJob.id);
  }, [failedJob, triggerRetry]);

  const handleRowRetryClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = Number(event.currentTarget.dataset.importId);
      if (Number.isInteger(id) && id > 0) {
        void triggerRetry(id);
      }
    },
    [triggerRetry],
  );

  if (loadPhase === "loading") {
    return <LoadingState variant="rows" count={4} />;
  }

  if (loadPhase === "error") {
    return (
      <ReadError
        title={copy.error.importsTitle}
        message={loadError ?? copy.api.unknownError}
        onRetry={loadInitial}
      />
    );
  }

  const dropDisabled = uploadState !== null || activeJob !== null;
  const uploadPct =
    uploadState && uploadState.total > 0
      ? Math.round((uploadState.loaded / uploadState.total) * 100)
      : 0;

  const jobStage = activeJob ? resolveJobStage(activeJob) : null;
  const notableChanges =
    changes?.overnight
      .filter((row) => row.severity === "notable" || row.severity === "alert")
      .slice(0, 3) ?? [];

  const failedExpired = failedJob
    ? failedJob.retryable === false || retryExpiredIds[failedJob.id] === true
    : false;
  const failedStageLabel = failedJob
    ? failedJob.stage && failedJob.stage in copy.pages.import.stages
      ? copy.pages.import.stages[failedJob.stage as keyof typeof copy.pages.import.stages]
      : copy.status[failedJob.status]
    : "";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.import.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.import.subtitle}</p>
      </div>

      {/* Drop zone (idle / disabled while running) */}
      <Card
        data-testid="import-dropzone"
        onDragOver={dropDisabled ? undefined : handleDragOver}
        onDragLeave={dropDisabled ? undefined : handleDragLeave}
        onDrop={dropDisabled ? undefined : handleDrop}
        className={cn(
          "transition-colors",
          dragActive && !dropDisabled ? "border-accent bg-accent/5" : "",
          dropDisabled ? "opacity-60" : "",
        )}
      >
        <CardContent className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept=".zip,application/zip"
            aria-label={copy.pages.import.fileInputLabel}
            disabled={dropDisabled}
            onChange={handleFileChange}
            className="sr-only"
          />

          {dropDisabled ? (
            <p className="text-sm font-medium text-muted-foreground" data-testid="dropzone-busy">
              {copy.pages.import.dropzoneDisabled}
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <span className="text-foreground font-medium">{copy.pages.import.dropzoneLabel}</span>
              <Button type="button" size="sm" onClick={handleChooseClick}>
                <Upload aria-hidden="true" />
                {copy.pages.import.chooseFile}
              </Button>
            </div>
          )}

          <p className="max-w-lg text-xs text-muted-foreground">
            {copy.pages.import.dropzoneInstructions}
          </p>
        </CardContent>
      </Card>

      {/* Upload / validation error (B-I1, B-I2, B-I11) */}
      {uploadError ? (
        <Alert variant="destructive" data-testid="import-error-alert">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <div>
            <AlertTitle>{copy.pages.import.failed.title}</AlertTitle>
            <AlertDescription>{uploadError}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      {/* Uploading state (XHR progress, B-I11) */}
      {uploadState ? (
        <Card data-testid="import-uploading">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">
                {copy.pages.import.uploadingTitle(uploadState.fileName)}
              </CardTitle>
              <span className="text-xs text-muted-foreground tabular-nums">
                {copy.pages.import.uploadingBytes(
                  formatMegabytes(uploadState.loaded),
                  formatMegabytes(uploadState.total),
                )}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress
              value={uploadPct}
              aria-label={copy.pages.import.uploadingTitle(uploadState.fileName)}
            />
            <p className="text-xs text-muted-foreground">{copy.pages.import.keepTabOpen}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Running job stepper (B-I7) */}
      {activeJob && jobStage ? (
        <Card data-testid="import-running">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                {IMPORT_STAGES.map((stage, idx) => {
                  const done = idx < jobStage.stageIndex;
                  const current = idx === jobStage.stageIndex;
                  return (
                    <span
                      key={stage}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium",
                        done ? "text-accent" : current ? "text-learning" : "text-muted-foreground",
                      )}
                    >
                      {done ? (
                        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : current ? (
                        <Loader2 aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <Circle aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                      <span>{copy.pages.import.stages[stage]}</span>
                    </span>
                  );
                })}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {jobStage.progressPct !== null ? `${Math.round(jobStage.progressPct)}% · ` : ""}
                {formatDurationClock(elapsedSeconds)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress
              value={jobStage.barValue}
              aria-label={copy.pages.import.stages[jobStage.stageKey]}
            />
            <p className="text-xs text-muted-foreground">{copy.pages.import.canCloseTab}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Failed job card (B-I5, B-I10) */}
      {failedJob ? (
        <Alert variant="destructive" data-testid="import-failed-card">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <AlertTitle>{copy.pages.import.failed.title}</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>
                  {copy.pages.import.failed.stageLabel(failedStageLabel)} ·{" "}
                  {failedJob.error ?? copy.api.importFailed}
                </p>
                {failedExpired ? (
                  <p className="text-foreground">{copy.pages.import.errors.retryExpired}</p>
                ) : null}
              </AlertDescription>
            </div>
            {!failedExpired ? (
              <Button
                variant="outline"
                size="sm"
                disabled={retryingId === failedJob.id}
                onClick={handleRetryCardClick}
                className="self-start sm:self-auto"
              >
                <RotateCw aria-hidden="true" />
                {retryingId === failedJob.id
                  ? copy.pages.import.failed.retrying
                  : copy.pages.import.failed.retry}
              </Button>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {/* Summary card (after done, B-I3, B-I4) */}
      {completedJob ? (
        <Card data-testid="import-summary">
          <CardContent className="space-y-3 pt-4">
            {completedJob.olderThanStored ? (
              <Alert variant="warning" data-testid="older-export-warning">
                <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                <AlertDescription>{copy.pages.import.summary.olderExportWarning}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground tabular-nums">
                {completedJob.recordsInserted === 0
                  ? copy.pages.import.summary.nothingNew
                  : [
                      copy.pages.import.summary.newRecords(completedJob.recordsInserted ?? 0),
                      copy.pages.import.summary.alreadyKnown(completedJob.recordsDeduped ?? 0),
                      completedJob.newUsableNights != null
                        ? copy.pages.import.summary.newUsableNights(completedJob.newUsableNights)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>

              <Button variant="link" size="sm" asChild className="px-0">
                <Link to="/">{copy.pages.import.summary.seeChangesCta}</Link>
              </Button>
            </div>

            {completedJob.recordsInserted === 0 && completedJob.recordsDeduped != null ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {copy.pages.import.summary.alreadyKnown(completedJob.recordsDeduped)}
              </p>
            ) : null}

            {completedJob.exportDate ||
            (completedJob.newEpochs && completedJob.newEpochs.length > 0) ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {[
                  completedJob.exportDate
                    ? copy.pages.import.summary.dataThrough(completedJob.exportDate.slice(0, 10))
                    : null,
                  completedJob.newEpochs && completedJob.newEpochs.length > 0
                    ? copy.pages.import.summary.newEpochs(completedJob.newEpochs)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}

            {notableChanges.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {copy.pages.import.summary.topChangesPrefix}{" "}
                {notableChanges
                  .map((row) =>
                    `${copy.metrics[row.metric] ?? row.metric} ${row.direction ? copy.direction[row.direction] : ""}`.trim(),
                  )
                  .join(", ")}
                .
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>{copy.pages.import.historyTitle}</CardTitle>
          {history.length === 0 ? (
            <CardDescription>{copy.pages.import.noImportsYet}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className={history.length === 0 ? "space-y-3" : "p-0"}>
          {history.length === 0 ? (
            <ol className="space-y-2 text-xs text-muted-foreground">
              {copy.empty.steps.map((item) => (
                <li key={item.step}>
                  <span className="font-medium text-foreground">
                    {item.step}. {item.title}
                  </span>{" "}
                  — {item.body}
                </li>
              ))}
            </ol>
          ) : (
            <Table data-testid="import-history-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.pages.import.rowWhen}</TableHead>
                  <TableHead>{copy.pages.import.rowExportDate}</TableHead>
                  <TableHead className="text-right">{copy.pages.import.rowNew}</TableHead>
                  <TableHead className="text-right">{copy.pages.import.rowKnown}</TableHead>
                  <TableHead className="text-right">{copy.pages.import.rowNightsAdded}</TableHead>
                  <TableHead className="text-right">{copy.pages.import.rowDuration}</TableHead>
                  <TableHead>{copy.pages.import.rowStatus}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => {
                  const rowRetryExpired =
                    row.retryable === false ||
                    retryExpiredIds[row.id] === true ||
                    isBadExportMessage(row.error);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums">{row.createdAt.slice(0, 10)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.exportDate ? row.exportDate.slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.recordsInserted !== null ? row.recordsInserted.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.recordsDeduped !== null ? row.recordsDeduped.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.newUsableNights != null ? row.newUsableNights.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatDurationMs(row.durationMs)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              row.status === "failed"
                                ? "alert"
                                : row.status === "done"
                                  ? "secondary"
                                  : "learning"
                            }
                          >
                            {copy.status[row.status]}
                          </Badge>
                          {row.status === "failed" && !rowRetryExpired ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              data-import-id={row.id}
                              disabled={retryingId === row.id}
                              onClick={handleRowRetryClick}
                            >
                              {copy.pages.import.failed.retry}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
