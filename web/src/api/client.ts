import { METRICS } from "@midori/domain/metrics";
import { copy } from "../copy";
import {
  changesStub,
  emptyChangesStub,
  epochsStub,
  metricSeriesStub,
  metricsIndexStub,
  nightsStub,
  OVERNIGHT_ORDER,
  unitEvidenceStub,
} from "./fixtures";
import type {
  ChangesDTO,
  EpochsDTO,
  ErrorResponse,
  ImportDTO,
  MetricRange,
  MetricSeriesDTO,
  MetricsIndexDTO,
  NightsDTO,
  UnitEvidenceDTO,
  UploadAcceptedDTO,
} from "./types";

/**
 * Typed REST client over the v1 contract (docs/design.md "Interfaces").
 * Until Slice 9 lands the v1 REST routes, 404 responses on v1 read endpoints
 * fall back to deterministic synthetic fixture stubs.
 */

export type ApiErrorKind = "http" | "network" | "parse" | "aborted";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
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
  baseUrl?: string;
  fetch?: FetchLike;
  /** Disable 404 stub fallback (for strict API testing against Slice 9+). */
  fallbackOn404?: boolean;
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (row: ImportDTO) => void;
}

export interface UploadOptions {
  name?: string;
  signal?: AbortSignal;
}

export interface ApiClient {
  changes(signal?: AbortSignal): Promise<ChangesDTO>;
  metricsIndex(signal?: AbortSignal): Promise<MetricsIndexDTO>;
  metricSeries(metric: string, range?: MetricRange, signal?: AbortSignal): Promise<MetricSeriesDTO>;
  unitEvidence(metric: string, day: string, signal?: AbortSignal): Promise<UnitEvidenceDTO>;
  epochs(signal?: AbortSignal): Promise<EpochsDTO>;
  nights(from: string, to: string, signal?: AbortSignal): Promise<NightsDTO>;
  imports(signal?: AbortSignal): Promise<ImportDTO[]>;
  importDetail(id: number, signal?: AbortSignal): Promise<ImportDTO>;
  retryImport(id: number, signal?: AbortSignal): Promise<UploadAcceptedDTO>;
  pollImport(id: number, options?: PollOptions): Promise<ImportDTO>;
  upload(file: File | Blob, opts?: UploadOptions): Promise<UploadAcceptedDTO>;
}

const DEFAULT_POLL_MS = 1500;

function isKnownMetric(metric: string): boolean {
  return metric in METRICS || (OVERNIGHT_ORDER as readonly string[]).includes(metric);
}

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

function is404(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "http" && err.status === 404;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const fallbackOn404 = options.fallbackOn404 ?? true;

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

  async function safeImportsForStub(signal?: AbortSignal): Promise<ImportDTO[] | null> {
    try {
      return await client.imports(signal);
    } catch {
      return null;
    }
  }

  function query(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(
      (e): e is [string, string | number] => e[1] !== undefined,
    );
    if (entries.length === 0) return "";
    return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
  }

  const client: ApiClient = {
    async changes(signal) {
      try {
        return await getJson<ChangesDTO>("/api/changes", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const rows = await safeImportsForStub(signal);
        if (rows !== null && rows.length === 0) return emptyChangesStub();
        return changesStub(rows ?? []);
      }
    },

    async metricsIndex(signal) {
      try {
        return await getJson<MetricsIndexDTO>("/api/metrics", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const rows = await safeImportsForStub(signal);
        return metricsIndexStub(rows === null ? true : rows.length > 0);
      }
    },

    async metricSeries(metric, range = "180d", signal) {
      try {
        return await getJson<MetricSeriesDTO>(
          `/api/metrics/${encodeURIComponent(metric)}${query({ range })}`,
          signal,
        );
      } catch (err) {
        if (!fallbackOn404 || !is404(err) || !isKnownMetric(metric)) throw err;
        return metricSeriesStub(metric, range);
      }
    },

    async unitEvidence(metric, day, signal) {
      try {
        return await getJson<UnitEvidenceDTO>(
          `/api/metrics/${encodeURIComponent(metric)}/units/${encodeURIComponent(day)}`,
          signal,
        );
      } catch (err) {
        if (!fallbackOn404 || !is404(err) || !isKnownMetric(metric)) throw err;
        return unitEvidenceStub(metric, day);
      }
    },

    async epochs(signal) {
      try {
        return await getJson<EpochsDTO>("/api/epochs", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const rows = await safeImportsForStub(signal);
        return epochsStub(rows === null ? true : rows.length > 0);
      }
    },

    async nights(from, to, signal) {
      try {
        return await getJson<NightsDTO>(`/api/nights${query({ from, to })}`, signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        return nightsStub(from, to);
      }
    },

    imports: (signal) => getJson<ImportDTO[]>("/api/imports", signal),

    async importDetail(id, signal) {
      try {
        return await getJson<ImportDTO>(`/api/imports/${id}`, signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const rows = await client.imports(signal);
        const found = rows.find((r) => r.id === id);
        if (!found) throw err;
        return found;
      }
    },

    retryImport(id, signal) {
      return send<UploadAcceptedDTO>(
        `/api/imports/${id}/retry`,
        { method: "POST", headers: { accept: "application/json" } },
        signal,
      );
    },

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

export const apiClient = createApiClient();
