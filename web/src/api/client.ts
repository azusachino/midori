import { copy } from "../copy";
import { isKnownMetric } from "../lib/metrics";
import type {
  BriefingDTO,
  ChangesDTO,
  EpochsDTO,
  ErrorResponse,
  FindingsDiffDTO,
  HealthContextDTO,
  HealthDTO,
  ImportDTO,
  MetricRange,
  MetricSeriesDTO,
  MetricsIndexDTO,
  NightsDTO,
  NoteDTO,
  NoteInputDTO,
  NotePatchDTO,
  ProfileContextDTO,
  ProfileInputDTO,
  UnitEvidenceDTO,
  UploadAcceptedDTO,
} from "./types";

/**
 * Typed REST client over the v1 contract (docs/design.md "Interfaces").
 * Synthetic 404 fallbacks are strictly gated to dev mode (import.meta.env.DEV)
 * so production builds never invent health data and instead surface errors.
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

export interface XhrProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

export interface XhrLike {
  upload: {
    onprogress: ((event: XhrProgressEventLike) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: File | Blob): void;
  abort(): void;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  createXhr?: () => XhrLike;
  /**
   * Override 404 synthetic stub fallback for unit tests.
   * Defaults to `Boolean(import.meta.env?.DEV)` — strictly false in production builds.
   */
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
  onProgress?: (loaded: number, total: number) => void;
}

export interface ApiClient {
  health(signal?: AbortSignal): Promise<HealthDTO>;
  profile(signal?: AbortSignal): Promise<ProfileContextDTO>;
  updateProfile(input: ProfileInputDTO, signal?: AbortSignal): Promise<ProfileContextDTO>;
  changes(signal?: AbortSignal): Promise<ChangesDTO>;
  metricsIndex(signal?: AbortSignal): Promise<MetricsIndexDTO>;
  metricSeries(metric: string, range?: MetricRange, signal?: AbortSignal): Promise<MetricSeriesDTO>;
  unitEvidence(metric: string, day: string, signal?: AbortSignal): Promise<UnitEvidenceDTO>;
  epochs(signal?: AbortSignal): Promise<EpochsDTO>;
  nights(from: string, to: string, signal?: AbortSignal): Promise<NightsDTO>;
  imports(signal?: AbortSignal): Promise<ImportDTO[]>;
  importDetail(id: number, signal?: AbortSignal): Promise<ImportDTO>;
  importDiff(id: number, signal?: AbortSignal): Promise<FindingsDiffDTO | null>;
  context(days: number, signal?: AbortSignal): Promise<HealthContextDTO>;
  notes(params?: { from?: string; to?: string }, signal?: AbortSignal): Promise<NoteDTO[]>;
  briefings(limit?: number, signal?: AbortSignal): Promise<BriefingDTO[]>;
  deleteBriefing(id: number, signal?: AbortSignal): Promise<void>;
  createNote(input: NoteInputDTO, signal?: AbortSignal): Promise<NoteDTO>;
  updateNote(id: number, patch: NotePatchDTO, signal?: AbortSignal): Promise<NoteDTO>;
  deleteNote(id: number, signal?: AbortSignal): Promise<void>;
  retryImport(id: number, signal?: AbortSignal): Promise<UploadAcceptedDTO>;
  pollImport(id: number, options?: PollOptions): Promise<ImportDTO>;
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

function is404(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "http" && err.status === 404;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const fallbackOn404 = options.fallbackOn404 ?? false;
  const xhrFactory: (() => XhrLike) | null =
    options.createXhr ??
    (!options.fetch && typeof XMLHttpRequest !== "undefined"
      ? () => new XMLHttpRequest() as unknown as XhrLike
      : null);

  function uploadViaXhr(file: File | Blob, opts: UploadOptions): Promise<UploadAcceptedDTO> {
    return new Promise((resolve, reject) => {
      if (!xhrFactory) {
        reject(new ApiError("network", copy.api.networkError));
        return;
      }
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const xhr = xhrFactory();
      let settled = false;

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        xhr.abort();
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      xhr.upload.onprogress = (event) => {
        const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
        opts.onProgress?.(event.loaded, total);
      };

      xhr.onload = () => {
        if (settled) return;
        settled = true;
        cleanup();
        let parsed: unknown = null;
        if (xhr.responseText.length > 0) {
          try {
            parsed = JSON.parse(xhr.responseText);
          } catch {
            if (xhr.status >= 200 && xhr.status < 300) {
              reject(new ApiError("parse", copy.api.unknownError, xhr.status));
              return;
            }
          }
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const body = isErrorBody(parsed) ? parsed : null;
          reject(new ApiError("http", body?.error ?? copy.api.unknownError, xhr.status, body));
          return;
        }
        if (parsed === null) {
          reject(new ApiError("parse", copy.api.unknownError, xhr.status));
          return;
        }
        resolve(parsed as UploadAcceptedDTO);
      };

      xhr.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new ApiError("network", copy.api.networkError));
      };

      xhr.onabort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(abortError());
      };

      xhr.open("POST", `${baseUrl}/api/imports`);
      xhr.setRequestHeader("accept", "application/json");
      xhr.setRequestHeader("content-type", "application/zip");
      if (opts.name !== undefined) {
        xhr.setRequestHeader("x-zip-name", opts.name);
      }
      xhr.send(file);
    });
  }

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
    async health(signal) {
      try {
        return await getJson<HealthDTO>("/api/health", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        return fixtures.healthStub();
      }
    },

    async profile(signal) {
      try {
        return await getJson<ProfileContextDTO>("/api/profile", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        return fixtures.emptyProfileStub();
      }
    },

    updateProfile(input, signal) {
      return send<ProfileContextDTO>(
        "/api/profile",
        {
          method: "PUT",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        signal,
      );
    },

    async changes(signal) {
      try {
        return await getJson<ChangesDTO>("/api/changes", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        const rows = await safeImportsForStub(signal);
        if (rows !== null && rows.length === 0) return fixtures.emptyChangesStub();
        return fixtures.changesStub(rows ?? []);
      }
    },

    async metricsIndex(signal) {
      try {
        return await getJson<MetricsIndexDTO>("/api/metrics", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        const rows = await safeImportsForStub(signal);
        return fixtures.metricsIndexStub(rows === null ? true : rows.length > 0);
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
        const fixtures = await import("./fixtures");
        return fixtures.metricSeriesStub(metric, range);
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
        const fixtures = await import("./fixtures");
        return fixtures.unitEvidenceStub(metric, day);
      }
    },

    async epochs(signal) {
      try {
        return await getJson<EpochsDTO>("/api/epochs", signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        const rows = await safeImportsForStub(signal);
        return fixtures.epochsStub(rows === null ? true : rows.length > 0);
      }
    },

    async nights(from, to, signal) {
      try {
        return await getJson<NightsDTO>(`/api/nights${query({ from, to })}`, signal);
      } catch (err) {
        if (!fallbackOn404 || !is404(err)) throw err;
        const fixtures = await import("./fixtures");
        return fixtures.nightsStub(from, to);
      }
    },

    imports: (signal) => getJson<ImportDTO[]>("/api/imports", signal),

    async importDetail(id, signal) {
      return getJson<ImportDTO>(`/api/imports/${id}`, signal);
    },

    async importDiff(id, signal) {
      const body = await getJson<{ diff: FindingsDiffDTO | null }>(
        `/api/imports/${id}/diff`,
        signal,
      );
      return body.diff;
    },

    /** B-T1: the same B-A5 dossier agents read, behind the Trends page. */
    async context(days, signal) {
      return getJson<HealthContextDTO>(`/api/context${query({ days })}`, signal);
    },

    async notes(params, signal) {
      const body = await getJson<{ notes: NoteDTO[] }>(
        `/api/notes${query({ from: params?.from, to: params?.to })}`,
        signal,
      );
      return body.notes;
    },

    async briefings(limit, signal) {
      const body = await getJson<{ briefings: BriefingDTO[] }>(
        `/api/briefings${query({ limit })}`,
        signal,
      );
      return body.briefings;
    },

    async deleteBriefing(id, signal) {
      await send<{ deleted: boolean }>(
        `/api/briefings/${id}`,
        { method: "DELETE", headers: { accept: "application/json" } },
        signal,
      );
    },

    createNote(input, signal) {
      return send<NoteDTO>(
        "/api/notes",
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(input),
        },
        signal,
      );
    },

    updateNote(id, patch, signal) {
      return send<NoteDTO>(
        `/api/notes/${id}`,
        {
          method: "PATCH",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
        signal,
      );
    },

    async deleteNote(id, signal) {
      await send<{ deleted: boolean }>(
        `/api/notes/${id}`,
        { method: "DELETE", headers: { accept: "application/json" } },
        signal,
      );
    },

    retryImport(id, signal) {
      return send<UploadAcceptedDTO>(
        `/api/imports/${id}/retry`,
        { method: "POST", headers: { accept: "application/json" } },
        signal,
      );
    },

    upload(file, opts = {}) {
      if (
        xhrFactory &&
        (opts.onProgress !== undefined || options.createXhr !== undefined || !options.fetch)
      ) {
        return uploadViaXhr(file, opts);
      }
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
        const row = await client.importDetail(id, signal);
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
