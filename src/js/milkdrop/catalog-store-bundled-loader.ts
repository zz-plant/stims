import {
  type BundledCatalogPipelineRequest,
  loadMergedBundledCatalog,
} from './catalog-bundled-pipeline.ts';
import type {
  BundledCatalogParseRequest,
  BundledCatalogParseResponse,
} from './catalog-parse-worker.ts';
import { shouldUseCertificationCorpus } from './catalog-query-override.ts';
import type {
  MilkdropBundledCatalogEntry,
  MilkdropPresetSource,
} from './types';

const DEFAULT_LIBRARY_MANIFEST_URLS = [
  '/milkdrop-presets/libraries/projectm-cream-of-the-crop/catalog.json',
  '/milkdrop-presets/libraries/projectm-upstream/catalog.json',
];

const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

export async function loadText(url: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * attempt),
      );
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = new Error(
          `Failed to fetch preset source (${response.status}): ${url}`,
        );
        continue;
      }

      return response.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error(`Timeout fetching preset source: ${url}`);
      } else if (error instanceof TypeError) {
        lastError = new Error(`Network error fetching preset source: ${url}`);
      } else {
        lastError =
          error instanceof Error
            ? error
            : new Error(`Unknown error fetching preset source: ${url}`);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch preset source: ${url}`);
}

/**
 * Once worker construction fails (older browser, CSP, bun test with no
 * Vite worker resolution), stop re-attempting it for the session.
 */
let catalogWorkerUnavailable = false;
let nextCatalogWorkerRequestId = 1;

/**
 * Runs the catalog fetch+parse+merge pipeline on a dedicated one-shot Web
 * Worker so the multi-MB JSON.parse never lands on the main thread while the
 * engine renders. Resolves `null` whenever the worker path is unusable —
 * construction failure, message error, or an in-worker pipeline error — so
 * the caller can fall back to the identical main-thread pipeline.
 */
async function loadMergedCatalogOnWorker(
  request: BundledCatalogPipelineRequest,
): Promise<MilkdropBundledCatalogEntry[] | null> {
  if (
    catalogWorkerUnavailable ||
    typeof Worker === 'undefined' ||
    // Bun (unit tests, scripts) has a Worker global but not Vite's `?worker`
    // module resolution; take the main-thread path there without noise.
    typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
  ) {
    return null;
  }

  let worker: Worker;
  try {
    const { default: CatalogWorkerCtor } = await import(
      './catalog-parse-worker.ts?worker'
    );
    worker = new CatalogWorkerCtor();
  } catch (error) {
    catalogWorkerUnavailable = true;
    console.warn(
      '[catalog-store] Catalog parse worker could not start; parsing on the main thread from here on:',
      error,
    );
    return null;
  }

  const requestId = nextCatalogWorkerRequestId;
  nextCatalogWorkerRequestId += 1;

  try {
    return await new Promise<MilkdropBundledCatalogEntry[] | null>(
      (resolve) => {
        worker.onmessage = (
          event: MessageEvent<BundledCatalogParseResponse>,
        ) => {
          const response = event.data;
          if (response.requestId !== requestId) {
            return;
          }
          resolve(response.ok ? response.entries : null);
        };
        worker.onerror = () => resolve(null);
        worker.onmessageerror = () => resolve(null);
        const message: BundledCatalogParseRequest = { requestId, ...request };
        worker.postMessage(message);
      },
    );
  } finally {
    worker.terminate();
  }
}

/**
 * Shared across loader instances, keyed by the manifest URLs it reads.
 *
 * The bundled catalog is a static asset, but more than one store gets built per
 * session — the workspace hook makes one and the milkdrop runtime makes another
 * — and a per-instance cache made each of them fetch and parse the full
 * catalog.json independently. That is ~1.5MB decoded per store, which is a
 * visible stall on a phone.
 */
const sharedBundledCatalogPromises = new Map<
  string,
  Promise<MilkdropBundledCatalogEntry[]>
>();

/** Test seam: drops the cross-instance cache. */
export function resetSharedBundledCatalogCache() {
  sharedBundledCatalogPromises.clear();
}

export function createBundledCatalogLoader({
  catalogUrl,
  libraryManifestUrls = DEFAULT_LIBRARY_MANIFEST_URLS,
}: {
  catalogUrl: string;
  libraryManifestUrls?: string[];
}) {
  const bundledSourceCache = new Map<string, MilkdropPresetSource>();
  const cacheKey = JSON.stringify([catalogUrl, libraryManifestUrls]);

  const getBundledCatalog = async () => {
    let bundledCatalogPromise = sharedBundledCatalogPromises.get(cacheKey);
    if (!bundledCatalogPromise) {
      // Read on the main thread — the worker cannot see URL params.
      const pipelineRequest: BundledCatalogPipelineRequest = {
        catalogUrl,
        libraryManifestUrls,
        useCertificationCorpus: shouldUseCertificationCorpus(),
      };
      bundledCatalogPromise = loadMergedCatalogOnWorker(pipelineRequest)
        .then((workerEntries) => {
          if (workerEntries !== null) {
            return workerEntries;
          }
          return loadMergedBundledCatalog(pipelineRequest);
        })
        .then((entries) => {
          if (entries.length === 0) {
            // Every source failed or came back empty (likely offline). Do not
            // cache the outcome — the next access should retry the fetch
            // instead of showing an empty library for the rest of the session.
            sharedBundledCatalogPromises.delete(cacheKey);
          }
          return entries;
        })
        .catch((error) => {
          sharedBundledCatalogPromises.delete(cacheKey);
          console.warn(
            '[catalog-store] Bundled catalog failed to load; will retry on next access:',
            error,
          );
          return [] as MilkdropBundledCatalogEntry[];
        });
      sharedBundledCatalogPromises.set(cacheKey, bundledCatalogPromise);
    }
    return bundledCatalogPromise;
  };

  const loadBundledSource = async (entry: MilkdropBundledCatalogEntry) => {
    const cached = bundledSourceCache.get(entry.id);
    if (cached) {
      return cached;
    }
    const raw = await loadText(entry.file);
    const source: MilkdropPresetSource = {
      id: entry.id,
      title: entry.title,
      author: entry.author,
      authorUrl: entry.authorUrl,
      raw,
      origin: 'bundled',
      path: entry.file,
    };
    bundledSourceCache.set(entry.id, source);
    return source;
  };

  return {
    getBundledCatalog,
    loadBundledSource,
  };
}
