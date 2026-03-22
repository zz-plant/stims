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

export async function loadText(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch preset source: ${url}`);
  }
  return response.text();
}

export function createBundledCatalogLoader({
  catalogUrl,
}: {
  catalogUrl: string;
}) {
  const bundledSourceCache = new Map<string, MilkdropPresetSource>();
  let bundledCatalogPromise: Promise<MilkdropBundledCatalogEntry[]> | null =
    null;

  const getBundledCatalog = async () => {
    if (!bundledCatalogPromise) {
      bundledCatalogPromise = fetch(catalogUrl, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) {
            return [] as MilkdropBundledCatalogEntry[];
          }
          const document = (await response.json()) as BundledCatalogDocument;
          if (Array.isArray(document)) {
            return document;
          }
          const defaultCertification = document.certification ?? 'bundled';
          const defaultCorpusTier = document.corpusTier ?? 'bundled';
          return (document.presets ?? []).map((entry) => ({
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
            supports: entry.supports ?? entry.compatibility,
          }));
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
