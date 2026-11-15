import type { ImportDTO, ImportStatus } from "@midori/domain/api";
import { type DragEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, createApiClient, ImportFailedError } from "../api/client";
import { PageSection } from "../components/PageSection";
import { copy } from "../copy";

/** One client for the page; requests are cancelled on unmount via AbortController. */
const api = createApiClient();

/** Order of the job's visible transitions; `done` is the terminal success step. */
const STEPS: readonly ImportStatus[] = ["queued", "unpacking", "parsing", "storing", "done"];

type Phase = "idle" | "uploading" | "running" | "done" | "failed" | "error";

interface PageState {
  phase: Phase;
  /** Latest observed row for the current run (null until the first poll answers). */
  row: ImportDTO | null;
  /** Human message for `failed` / `error` phases. */
  message: string | null;
}

const INITIAL: PageState = { phase: "idle", row: null, message: null };

function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatCount(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

function formatDuration(ms: number | null): string {
  return ms === null ? "—" : copy.pages.import.summaryDuration(ms);
}

export function ImportPage() {
  const inputId = useId();
  const hintId = useId();
  const statusId = useId();
  const [state, setState] = useState<PageState>(INITIAL);
  const [history, setHistory] = useState<ImportDTO[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const runRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.phase === "uploading" || state.phase === "running";

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await api.imports(signal);
      setHistory(rows);
      setHistoryError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setHistoryError(err instanceof Error ? err.message : copy.api.unknownError);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadHistory(ac.signal);
    return () => {
      ac.abort();
      runRef.current?.abort();
    };
  }, [loadHistory]);

  const startUpload = useCallback(
    async (file: File) => {
      if (!isZipName(file.name)) {
        setState({ phase: "error", row: null, message: copy.pages.import.wrongFileType });
        return;
      }
      runRef.current?.abort();
      const ac = new AbortController();
      runRef.current = ac;
      setState({ phase: "uploading", row: null, message: null });
      try {
        const accepted = await api.upload(file, { name: file.name, signal: ac.signal });
        setState((s) => ({ ...s, phase: "running" }));
        const row = await api.pollImport(accepted.importId, {
          signal: ac.signal,
          onUpdate: (observed) => setState((s) => ({ ...s, row: observed })),
        });
        setState({ phase: "done", row, message: null });
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof ImportFailedError) {
          setState((s) => ({
            ...s,
            phase: "failed",
            message: err.reason ?? copy.api.importFailed,
          }));
        } else if (err instanceof ApiError && err.status === 409) {
          setState({ phase: "error", row: null, message: copy.pages.import.retryHint });
        } else {
          const message = err instanceof Error ? err.message : copy.api.unknownError;
          setState((s) => ({ ...s, phase: "error", message }));
        }
      } finally {
        if (!ac.signal.aborted) void loadHistory(ac.signal);
      }
    },
    [loadHistory],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file && !busy) void startUpload(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [busy, startUpload],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setDragging(false);
      onFiles(event.dataTransfer.files);
    },
    [onFiles],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!busy) setDragging(true);
    },
    [busy],
  );

  const statusText = (() => {
    if (state.phase === "uploading") return copy.pages.import.uploading;
    if (state.phase === "running") return copy.status[state.row?.status ?? "queued"];
    if (state.phase === "done") return copy.status.done;
    if (state.phase === "failed") return copy.pages.import.failedTitle;
    if (state.phase === "error") return state.message ?? "";
    return "";
  })();

  const currentStep = state.row?.status ?? (state.phase === "uploading" ? "queued" : null);
  const currentIndex = currentStep ? STEPS.indexOf(currentStep) : -1;
  const summaryRow = state.phase === "done" ? state.row : null;

  const onDragLeave = useCallback(() => setDragging(false), []);
  const onInputChange = useCallback(
    (e: { currentTarget: { files: FileList | null } }) => onFiles(e.currentTarget.files),
    [onFiles],
  );
  const onClick = useCallback(() => inputRef.current?.click(), []);

  return (
    <PageSection title={copy.pages.import.title}>
      <section className="import-zone" aria-label={copy.pages.import.dropzoneLabel}>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".zip,application/zip"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onInputChange}
        />
        <button
          type="button"
          className="import-dropzone"
          data-dragging={dragging || undefined}
          data-busy={busy || undefined}
          disabled={busy}
          aria-describedby={hintId}
          onClick={onClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <span className="import-dropzone__label">
            {busy ? copy.pages.import.dropzoneBusy : copy.pages.import.dropzoneLabel}
          </span>
          <span id={hintId} className="import-dropzone__hint">
            {copy.pages.import.dropzoneHint}
          </span>
        </button>

        <div id={statusId} className="import-status" aria-live="polite">
          {statusText !== "" && (
            <p
              className="import-status__text"
              data-phase={state.phase}
              role={state.phase === "error" || state.phase === "failed" ? "alert" : undefined}
            >
              {statusText}
              {state.phase === "failed" && state.message !== null && (
                <span className="import-status__detail"> {state.message}</span>
              )}
            </p>
          )}
          {(state.phase === "running" || state.phase === "uploading" || summaryRow !== null) && (
            <ol className="import-steps" aria-label={copy.pages.import.rowStatus}>
              {STEPS.map((step, i) => (
                <li
                  key={step}
                  data-state={
                    currentIndex < 0
                      ? undefined
                      : i < currentIndex
                        ? "past"
                        : i === currentIndex
                          ? "current"
                          : undefined
                  }
                  aria-current={i === currentIndex ? "step" : undefined}
                >
                  {copy.status[step]}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {summaryRow !== null && (
        <section className="import-summary" aria-labelledby={`${statusId}-summary`}>
          <h2 id={`${statusId}-summary`}>{copy.pages.import.summaryTitle}</h2>
          <ul>
            <li>{copy.pages.import.summaryInserted(summaryRow.recordsInserted ?? 0)}</li>
            <li>{copy.pages.import.summaryDeduped(summaryRow.recordsDeduped ?? 0)}</li>
            <li>{formatDuration(summaryRow.durationMs)}</li>
          </ul>
        </section>
      )}

      <section className="import-history" aria-labelledby={`${statusId}-history`}>
        <h2 id={`${statusId}-history`}>{copy.pages.import.historyTitle}</h2>
        {historyError !== null && <p className="import-history__error">{historyError}</p>}
        {history !== null && history.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{copy.pages.import.rowWhen}</th>
                  <th scope="col">{copy.pages.import.rowStatus}</th>
                  <th scope="col" className="num">
                    {copy.pages.import.rowInserted}
                  </th>
                  <th scope="col" className="num">
                    {copy.pages.import.rowDeduped}
                  </th>
                  <th scope="col" className="num">
                    {copy.pages.import.rowDuration}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} data-status={row.status}>
                    <td>
                      <time dateTime={row.createdAt}>{formatWhen(row.createdAt)}</time>
                    </td>
                    <td>{copy.status[row.status]}</td>
                    <td className="num">{formatCount(row.recordsInserted)}</td>
                    <td className="num">{formatCount(row.recordsDeduped)}</td>
                    <td className="num">{formatDuration(row.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageSection>
  );
}
