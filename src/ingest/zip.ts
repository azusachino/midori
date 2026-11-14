import type { Entry } from "yauzl";
import yauzl from "yauzl";

/**
 * export.zip access (T5). Apple's archive places the XML under
 * `apple_health_export/export.xml`; the sibling `export_cda.xml` is a clinical
 * document archive we deliberately do not parse.
 */

export interface ZipEntryInfo {
  fileName: string;
  uncompressedSize: number;
}

export interface ExportXmlHandle {
  /** Entry name that was selected, e.g. 'apple_health_export/export.xml'. */
  entryName: string;
  totalEntries: number;
  /** All non-directory entry names, for presence logging. */
  entryNames: string[];
  chunks: AsyncIterable<Buffer>;
  /** Resolves when the archive fd is released (after `chunks` is consumed). */
  closed: Promise<void>;
}

const CDA_RE = /_cda\.xml$/i;
const EXPORT_XML_RE = /apple_health_export\/export\.xml$/i;
const ANY_EXPORT_XML_RE = /(^|\/)export\.xml$/i;

function isExportXml(name: string): boolean {
  if (CDA_RE.test(name)) return false;
  return EXPORT_XML_RE.test(name) || ANY_EXPORT_XML_RE.test(name);
}

export async function listZipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true });
  const out: ZipEntryInfo[] = [];
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName.endsWith("/")) continue;
      out.push({ fileName: entry.fileName, uncompressedSize: entry.uncompressedSize });
    }
  } finally {
    await new Promise<void>((resolve) => {
      zipfile.close();
      resolve();
    });
  }
  return out;
}

/**
 * Locates export.xml inside the archive and returns a chunk stream over its
 * decompressed contents plus summary info. The archive itself is never fully
 * extracted; nothing but the XML entry is read.
 */
export async function openExportXml(zipPath: string): Promise<ExportXmlHandle> {
  // autoClose stays off: eachEntry() finishing must not close the fd before we
  // open the read stream for the chosen entry.
  const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  const entryNames: string[] = [];
  let chosen: Entry | null = null;
  let total = 0;
  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName.endsWith("/")) continue;
      total += 1;
      entryNames.push(entry.fileName);
      if (!chosen && isExportXml(entry.fileName)) chosen = entry;
    }
  } catch (err) {
    await new Promise<void>((resolve) => {
      zipfile.close();
      resolve();
    });
    throw err;
  }

  if (!chosen) {
    await new Promise<void>((resolve) => {
      zipfile.close();
      resolve();
    });
    throw new Error(
      `no export.xml found in archive (${total} entries: ${entryNames.slice(0, 5).join(", ")}${total > 5 ? ", …" : ""})`,
    );
  }

  const entry = chosen;
  const readStream = await zipfile.openReadStreamPromise(entry);
  // Own the fd lifecycle (autoClose is off): close once the entry stream is done.
  const closed = new Promise<void>((resolve) => {
    const done = () => {
      zipfile.close();
      resolve();
    };
    readStream.once("end", done);
    readStream.once("close", done);
    readStream.once("error", done);
  });

  return { entryName: entry.fileName, totalEntries: total, entryNames, chunks: readStream, closed };
}
