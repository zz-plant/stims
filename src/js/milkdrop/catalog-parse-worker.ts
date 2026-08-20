/**
 * Web Worker entry that fetches, parses, and merges the bundled preset
 * catalog off the main thread. The full catalog is multiple MB of JSON;
 * parsing it on the main thread while the engine renders shows up as a long
 * task on phones. Structured-cloning the merged entries back is far cheaper
 * than the parse itself.
 *
 * Protocol: receives a {@link BundledCatalogParseRequest}, answers with a
 * {@link BundledCatalogParseResponse} carrying the same `requestId`.
 * Environment-sensitive inputs (certification-corpus URL param) are resolved
 * by the caller — this worker never reads window state.
 */
import {
  type BundledCatalogPipelineRequest,
  loadMergedBundledCatalog,
} from './catalog-bundled-pipeline.ts';
import type { MilkdropBundledCatalogEntry } from './types';

export type BundledCatalogParseRequest = BundledCatalogPipelineRequest & {
  requestId: number;
};

export type BundledCatalogParseResponse =
  | { requestId: number; ok: true; entries: MilkdropBundledCatalogEntry[] }
  | { requestId: number; ok: false; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BundledCatalogParseRequest>) => void) | null;
  postMessage: (message: BundledCatalogParseResponse) => void;
};

scope.onmessage = async (event) => {
  const { requestId, catalogUrl, libraryManifestUrls, useCertificationCorpus } =
    event.data;
  try {
    const entries = await loadMergedBundledCatalog({
      catalogUrl,
      libraryManifestUrls,
      useCertificationCorpus,
    });
    scope.postMessage({ requestId, ok: true, entries });
  } catch (error) {
    scope.postMessage({
      requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
