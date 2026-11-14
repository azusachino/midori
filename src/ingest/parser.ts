import { SaxesParser } from "saxes";

/**
 * Streaming export.xml parser (T5). Never materializes the document: records
 * are delivered one at a time to a callback; everything else is counted as
 * presence (Workout, WorkoutRoute, ECG file references, ...).
 */

export interface XmlRecordRow {
  type: string;
  sourceName: string;
  unit: string | null;
  /** Raw value attribute; null when absent. Numeric for quantities, enum for categories. */
  value: string | null;
  startDate: string;
  endDate: string;
}

export interface ParserHandlers {
  onRecord(row: XmlRecordRow): void | Promise<void>;
}

export interface PresenceLog {
  /** tag name (as written) → count. Includes Record for completeness. */
  [tag: string]: number;
}

export interface XmlParseStats {
  recordCount: number;
  presence: PresenceLog;
  /** HealthData@exportDate */
  exportDate: string | null;
  /** '17' from the 'HealthKit Export Version' comment, when present. */
  exportVersion: string | null;
}

function attribute(attrs: Record<string, unknown> | undefined, name: string): string | null {
  const v = attrs?.[name];
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : String(v);
}

/**
 * Parses HealthKit export XML from a chunk stream (strings or bytes; multibyte
 * splits are handled by a streaming TextDecoder). Resolves with stats once the
 * document ends; rejects on XML well-formedness errors.
 */
export async function parseExportXml(
  chunks: AsyncIterable<string | Uint8Array>,
  handlers: ParserHandlers,
): Promise<XmlParseStats> {
  const parser = new SaxesParser({ fragment: false });
  const stats: XmlParseStats = {
    recordCount: 0,
    presence: {},
    exportDate: null,
    exportVersion: null,
  };

  let ended = false;
  let failure: Error | null = null;
  const end = new Promise<void>((resolve, reject) => {
    parser.on("error", (err: Error) => {
      if (!failure) failure = err;
      reject(err);
    });
    parser.on("end", () => {
      ended = true;
      resolve();
    });
  });

  parser.on("opentag", (node: { name: string; attributes?: Record<string, unknown> }) => {
    if (failure) return;
    stats.presence[node.name] = (stats.presence[node.name] ?? 0) + 1;
    if (node.name === "ExportDate") {
      stats.exportDate ??= attribute(node.attributes, "value");
      return;
    }
    if (node.name !== "Record") return;

    const row: XmlRecordRow = {
      type: attribute(node.attributes, "type") ?? "",
      sourceName: attribute(node.attributes, "sourceName") ?? "",
      unit: attribute(node.attributes, "unit"),
      value: attribute(node.attributes, "value"),
      startDate: attribute(node.attributes, "startDate") ?? "",
      endDate: attribute(node.attributes, "endDate") ?? "",
    };
    stats.recordCount += 1;
    const r = handlers.onRecord(row);
    if (r instanceof Promise) {
      // Queue the promise; the XML stream is consumed synchronously, so the
      // pending writes settle before `end` resolves in practice. Keep simple:
      // track it so callers that need backpressure can await via flushes.
      pending.push(r);
    }
  });

  parser.on("comment", (text: string) => {
    const m = /HealthKit Export Version:?\s*([\d.]+)/i.exec(text);
    if (m?.[1]) stats.exportVersion = m[1];
  });

  const pending: Promise<void>[] = [];
  const decoder = new TextDecoder("utf-8");
  try {
    for await (const chunk of chunks) {
      if (failure) throw failure;
      parser.write(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    }
    parser.write(decoder.decode());
    parser.close();
    await end;
  } catch (err) {
    // Surface saxes' own error, or rethrow.
    throw err instanceof Error ? err : new Error(String(err));
  }
  await Promise.all(pending);
  if (!ended) throw new Error("parser ended without end event");
  return stats;
}
