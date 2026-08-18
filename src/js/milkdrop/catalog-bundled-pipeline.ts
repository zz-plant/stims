/**
 * The fetch + parse + merge pipeline for the bundled preset catalog.
 *
 * Kept free of window/DOM reads so the exact same code runs on the main
 * thread (test environments, worker-less browsers) and inside
 * `catalog-parse-worker.ts`. Anything environment-sensitive — like whether
 * the certification corpus was requested via URL param — is evaluated by the
 * caller and passed in as data.
 */
import type { MilkdropBundledCatalogEntry } from './types';

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
  '/src/data/milkdrop-parity/certification-corpus.json';

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
        similarity: entry.similarity,
        certification: entry.certification ?? defaultCertification,
        corpusTier: entry.corpusTier ?? defaultCorpusTier,
        expectedFidelityClass: entry.expectedFidelityClass,
        visualEvidenceTier: entry.visualEvidenceTier,
        semanticSupport: entry.semanticSupport,
        visualCertification: entry.visualCertification,
        supports: entry.supports ?? entry.compatibility,
        preview: entry.preview,
      }));
}

async function loadOptionalCatalog(
  catalogUrl: string,
  { reportFailures = true }: { reportFailures?: boolean } = {},
): Promise<MilkdropBundledCatalogEntry[]> {
  return fetch(catalogUrl)
    .then(async (response) => {
      if (!response.ok) {
        if (reportFailures) {
          console.warn(`Optional catalog not found: ${catalogUrl}`);
        }
        return [] as MilkdropBundledCatalogEntry[];
      }
      const document = (await response.json()) as BundledCatalogDocument;
      return toBundledCatalogEntries(document);
    })
    .catch((error) => {
      if (reportFailures) {
        console.warn(`Failed to load optional catalog: ${catalogUrl}`, error);
      }
      return [] as MilkdropBundledCatalogEntry[];
    });
}

export function mergeUniqueCatalogEntries(
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

export type BundledCatalogPipelineRequest = {
  catalogUrl: string;
  libraryManifestUrls: string[];
  useCertificationCorpus: boolean;
};

export async function loadMergedBundledCatalog({
  catalogUrl,
  libraryManifestUrls,
  useCertificationCorpus,
}: BundledCatalogPipelineRequest): Promise<MilkdropBundledCatalogEntry[]> {
  const [bundledEntries, libraryCatalogs] = await Promise.all([
    loadOptionalCatalog(catalogUrl),
    Promise.all(
      libraryManifestUrls.map((url) =>
        loadOptionalCatalog(url, { reportFailures: false }),
      ),
    ),
  ]);

  const supplementalEntries = libraryCatalogs.flat();
  const mergedEntries = mergeUniqueCatalogEntries(
    bundledEntries,
    supplementalEntries,
  );
  if (!useCertificationCorpus) {
    return mergedEntries;
  }

  let certificationEntries: MilkdropBundledCatalogEntry[] = [];
  try {
    certificationEntries = await loadCertificationCorpusCatalog();
  } catch (error) {
    // A broken supplemental corpus must not take the primary
    // catalog down with it.
    console.warn(
      '[catalog-store] Certification corpus failed to load; continuing without it:',
      error,
    );
  }
  return mergeUniqueCatalogEntries(mergedEntries, certificationEntries);
}
