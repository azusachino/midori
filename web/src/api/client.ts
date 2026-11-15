import type {
  BriefingDTO,
  DeviationDTO,
  ErrorResponse,
  FindingDTO,
  ImportDTO,
  MetricDailyDTO,
  SourceDTO,
  UploadAcceptedDTO,
} from "@midori/domain/api";
import { copy } from "../copy";

/**
 * Typed client over the REST contract (src/domain/api.ts). Shapes are imported from the
 * server's DTO module, never redeclared here. Relative URLs: Vite proxies /api in dev,
 * and the Bun server serves both in production.
 */

export type ApiErrorKind = "http" | "network" | "parse" | "aborted";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Typed error body from the server when one was sent (ErrorResponse). */
  readonly body: ErrorResponse | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    body: ErrorResponse | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

/** Thrown by pollImport when the job ends in `failed`; carries the server's row.error. */
export class ImportFailedError extends Error {
  readonly importId: number;
  readonly reason: string | null;

  constructor(importId: number, reason: string | null) {
    super(reason ?? copy.api.importFailed);
    this.name = "ImportFailedError";
    this.importId = importId;
    this.reason = reason;
  }
}

/** Thrown by pollImport when the import id is no longer in the run history. */
export class ImportNotFoundError extends Error {
  readonly importId: number;

  constructor(importId: number) {
    super(copy.api.importNotFound);
    this.name = "ImportNotFoundError";
    this.importId = importId;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Prefix for every request; empty string means same origin. */
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  /** Called with each observed row, so the UI can show status transitions. */
  onUpdate?: (row: ImportDTO) => void;
}

export interface UploadOptions {
  /** Original file name, sent as the x-zip-name header (the server sanitizes it). */
  name?: string;
  signal?: AbortSignal;
}

export interface ApiClient {
  briefing(signal?: AbortSignal): Promise<BriefingDTO>;
  imports(signal?: AbortSignal): Promise<ImportDTO[]>;
  sources(signal?: AbortSignal): Promise<SourceDTO[]>;
  findings(signal?: AbortSignal): Promise<FindingDTO[]>;
  deviations(days?: number, signal?: AbortSignal): Promise<DeviationDTO[]>;
  metricDaily(metric: string, signal?: AbortSignal): Promise<MetricDailyDTO[]>;
  pollImport(id: number, options?: PollOptions): Promise<ImportDTO>;
  /** POST /api/imports with the raw zip as the body; resolves to the 202 job receipt. */
  upload(file: File | Blob, opts?: UploadOptions): Promise<UploadAcceptedDTO>;
}

const DEFAULT_POLL_MS = 1500;

function isErrorBody(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function abortError(): ApiError {
  return new ApiError("aborted", copy.api.aborted);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  /** Sends one request and maps every failure to a typed ApiError. */
  async function send<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted) throw abortError();
      if (err instanceof ApiError) throw err;
      throw new ApiError("network", copy.api.networkError);
    }

    let parsed: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (res.ok) throw new ApiError("parse", copy.api.unknownError, res.status);
      }
    }

    if (!res.ok) {
      const body = isErrorBody(parsed) ? parsed : null;
      throw new ApiError("http", body?.error ?? copy.api.unknownError, res.status, body);
    }
    if (parsed === null) throw new ApiError("parse", copy.api.unknownError, res.status);
    return parsed as T;
  }

  function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return send<T>(path, { headers: { accept: "application/json" } }, signal);
  }

  function query(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(
      (e): e is [string, string | number] => e[1] !== undefined,
    );
    if (entries.length === 0) return "";
    return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
  }

  const client: ApiClient = {
    briefing: (signal) => getJson<BriefingDTO>("/api/briefing", signal),
    imports: (signal) => getJson<ImportDTO[]>("/api/imports", signal),
    sources: (signal) => getJson<SourceDTO[]>("/api/sources", signal),
    findings: (signal) => getJson<FindingDTO[]>("/api/findings", signal),
    deviations: (days, signal) =>
      getJson<DeviationDTO[]>(`/api/deviations${query({ days })}`, signal),
    metricDaily: (metric, signal) =>
      getJson<MetricDailyDTO[]>(`/api/metrics/${encodeURIComponent(metric)}/daily`, signal),

    upload(file, opts = {}) {
      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/zip",
      };
      if (opts.name !== undefined) headers["x-zip-name"] = opts.name;
      return send<UploadAcceptedDTO>(
        "/api/imports",
        { method: "POST", headers, body: file },
        opts.signal,
      );
    },

    async pollImport(id, opts = {}) {
      const intervalMs = opts.intervalMs ?? DEFAULT_POLL_MS;
      const signal = opts.signal;
      for (;;) {
        if (signal?.aborted) throw abortError();
        const rows = await client.imports(signal);
        const row = rows.find((r) => r.id === id);
        if (!row) throw new ImportNotFoundError(id);
        opts.onUpdate?.(row);
        if (row.status === "done") return row;
        if (row.status === "failed") throw new ImportFailedError(id, row.error);
        await sleep(intervalMs, signal);
      }
    },
  };

  return client;
}

/** Resolves after `ms`, or rejects with an aborted ApiError as soon as `signal` fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
