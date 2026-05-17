import { shouldUseCertificationCorpus } from './catalog-query-override.ts';
import type {
  MilkdropBundledCatalogEntry,
  MilkdropPresetSource,
} from './types';

type BundledCatalogDocument =
  | MilkdropBundledCatalogEntry[]
  | {
      certification?: 'bundled' | 'certified' | 'exploratory';
      corpusTier?: 'bundled' | 'certified' | 'exploratory';
      presets?: Array<
        MilkdropBundledCatalogEntry & {
          order?: number;
          compatibility?: {
            webgl?: boolean;
            webgpu?: boolean;
          };
        }
      >;
    };

type CertificationCorpusDocument = {
  presets?: Array<{
    id: string;
    title: string;
    file: string;
    fixtureRoot: string;
    sourceFamily?: string;
    strata?: string[];
  }>;
};

const CERTIFICATION_CORPUS_URL =
  '/assets/data/milkdrop-parity/certification-corpus.json';
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

function buildCertificationCorpusFileUrl(
  fixtureRoot: string,
  fileName: string,
) {
  const normalizedFixtureRoot = fixtureRoot.replace(/^\/+/, '');
  const publicRelativeRoot = normalizedFixtureRoot.startsWith('public/')
    ? normalizedFixtureRoot.slice('public/'.length)
    : normalizedFixtureRoot;
  const normalizedRoot = publicRelativeRoot.replace(/\/+$/, '');
  return `/${[normalizedRoot, fileName].filter(Boolean).join('/')}`;
}

async function loadCertificationCorpusCatalog(): Promise<
  MilkdropBundledCatalogEntry[]
> {
  const response = await fetch(CERTIFICATION_CORPUS_URL);
  if (!response.ok) {
    return [] as MilkdropBundledCatalogEntry[];
  }

  const document = (await response.json()) as CertificationCorpusDocument;
  return (document.presets ?? []).map(
    (entry, index): MilkdropBundledCatalogEntry => ({
      id: entry.id,
      title: entry.title,
      file: buildCertificationCorpusFileUrl(entry.fixtureRoot, entry.file),
      tags: [
        ...(entry.strata ?? []),
        ...(entry.sourceFamily ? [entry.sourceFamily] : []),
        'certification-corpus',
      ],
      curatedRank: 10_000 + index,
      certification: 'certified',
      corpusTier: 'certified',
    }),
  );
}

function toBundledCatalogEntries(document: BundledCatalogDocument) {
  const defaultCertification = Array.isArray(document)
    ? 'bundled'
    : (document.certification ?? 'bundled');
  const defaultCorpusTier = Array.isArray(document)
    ? 'bundled'
    : (document.corpusTier ?? 'bundled');

  return Array.isArray(document)
    ? document
    : (document.presets ?? []).map((entry) => ({
        id: entry.id,
        title: entry.title,
        author: entry.author,
        file: entry.file,
        tags: entry.tags,
        curatedRank: entry.curatedRank ?? entry.order,
        certification: entry.certification ?? defaultCertification,
        corpusTier: entry.corpusTier ?? defaultCorpusTier,
        expectedFidelityClass: entry.expectedFidelityClass,
        visualEvidenceTier: entry.visualEvidenceTier,
        semanticSupport: entry.semanticSupport,
        visualCertification: entry.visualCertification,
        supports: entry.supports ?? entry.compatibility,
      }));
}

async function loadOptionalCatalog(
  catalogUrl: string,
): Promise<MilkdropBundledCatalogEntry[]> {
  return fetch(catalogUrl)
    .then(async (response) => {
      if (!response.ok) {
        console.warn(`Optional catalog not found: ${catalogUrl}`);
        return [] as MilkdropBundledCatalogEntry[];
      }
      const document = (await response.json()) as BundledCatalogDocument;
      return toBundledCatalogEntries(document);
    })
    .catch((error) => {
      console.warn(`Failed to load optional catalog: ${catalogUrl}`, error);
      return [] as MilkdropBundledCatalogEntry[];
    });
}

function mergeUniqueCatalogEntries(
  ...catalogs: MilkdropBundledCatalogEntry[][]
): MilkdropBundledCatalogEntry[] {
  const entriesById = new Map<string, MilkdropBundledCatalogEntry>();

  catalogs.forEach((catalog) => {
    catalog.forEach((entry) => {
      if (!entriesById.has(entry.id)) {
        entriesById.set(entry.id, entry);
      }
    });
  });

  return [...entriesById.values()];
}

export function createBundledCatalogLoader({
  catalogUrl,
  libraryManifestUrls = DEFAULT_LIBRARY_MANIFEST_URLS,
}: {
  catalogUrl: string;
  libraryManifestUrls?: string[];
}) {
  const bundledSourceCache = new Map<string, MilkdropPresetSource>();
  let bundledCatalogPromise: Promise<MilkdropBundledCatalogEntry[]> | null =
    null;

  const getBundledCatalog = async () => {
    if (!bundledCatalogPromise) {
      bundledCatalogPromise = Promise.all([
        loadOptionalCatalog(catalogUrl),
        Promise.all(libraryManifestUrls.map((url) => loadOptionalCatalog(url))),
      ])
        .then(async ([bundledEntries, libraryCatalogs]) => {
          const supplementalEntries = libraryCatalogs.flat();
          const mergedEntries = mergeUniqueCatalogEntries(
            bundledEntries,
            supplementalEntries,
          );
          if (!shouldUseCertificationCorpus()) {
            return mergedEntries;
          }

          const certificationEntries = await loadCertificationCorpusCatalog();
          return mergeUniqueCatalogEntries(mergedEntries, certificationEntries);
        })
        .catch(() => [] as MilkdropBundledCatalogEntry[]);
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
