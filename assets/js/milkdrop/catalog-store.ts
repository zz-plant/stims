import { compileMilkdropPresetSource } from './compiler';
import type {
  MilkdropBackendSupport,
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropPresetSource,
} from './types';

type StoredPresetRecord = MilkdropPresetSource;

type StoredMetaRecord = {
  id: string;
  favorite?: boolean;
  rating?: number;
  lastOpenedAt?: number;
  draft?: string;
  stack?: string[];
};

type BundledCatalogDocument =
  | MilkdropBundledCatalogEntry[]
  | {
      certification?: 'bundled' | 'certified' | 'exploratory';
      corpusTier?: 'bundled' | 'certified' | 'exploratory';
      expectedFidelityClass?: MilkdropBundledCatalogEntry['expectedFidelityClass'];
      visualEvidenceTier?: MilkdropBundledCatalogEntry['visualEvidenceTier'];
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

const HISTORY_RECORD_ID = '__history__';
const DB_OPEN_TIMEOUT_MS = 750;

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'milkdrop-preset'
  );
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb(name: string) {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDbWithTimeout(name: string, timeoutMs = DB_OPEN_TIMEOUT_MS) {
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, timeoutMs);

    openDb(name).then(
      (db) => {
        if (settled) {
          db?.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(db);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function getAllRecords<T>(db: IDBDatabase | null, storeName: string) {
  if (!db) {
    return [] as T[];
  }
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const records = await requestToPromise(store.getAll() as IDBRequest<T[]>);
  await transactionDone(transaction);
  return records;
}

async function getRecord<T>(
  db: IDBDatabase | null,
  storeName: string,
  key: string,
) {
  if (!db) {
    return null as T | null;
  }
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const record = await requestToPromise(
    store.get(key) as IDBRequest<T | undefined>,
  );
  await transactionDone(transaction);
  return record ?? null;
}

async function putRecord<T extends { id: string }>(
  db: IDBDatabase | null,
  storeName: string,
  record: T,
) {
  if (!db) {
    return;
  }
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(record);
  await transactionDone(transaction);
}

async function deleteRecord(
  db: IDBDatabase | null,
  storeName: string,
  key: string,
) {
  if (!db) {
    return;
  }
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

async function loadText(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch preset source: ${url}`);
  }
  return response.text();
}

function supportsFromCompiled(compiled: MilkdropCompiledPreset): {
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
} {
  return {
    webgl: compiled.ir.compatibility.backends.webgl,
    webgpu: compiled.ir.compatibility.backends.webgpu,
  };
}

function toCatalogEntry(
  source: MilkdropPresetSource,
  compiled: MilkdropCompiledPreset,
  meta: StoredMetaRecord | null,
  options: {
    tags?: string[];
    curatedRank?: number;
    bundledFile?: string;
    historyIndex?: number;
    corpusTier?: MilkdropCatalogEntry['corpusTier'];
    certification?: MilkdropCatalogEntry['certification'];
    expectedFidelityClass?: MilkdropCatalogEntry['fidelityClass'];
    visualEvidenceTier?: MilkdropCatalogEntry['visualEvidenceTier'];
  } = {},
): MilkdropCatalogEntry {
  return {
    id: source.id,
    title: compiled.title,
    author: compiled.author ?? source.author,
    origin: source.origin,
    tags: options.tags ?? [],
    curatedRank: options.curatedRank,
    isFavorite: Boolean(meta?.favorite),
    rating: meta?.rating ?? 0,
    lastOpenedAt: meta?.lastOpenedAt,
    updatedAt: source.updatedAt,
    historyIndex: options.historyIndex,
    featuresUsed: compiled.ir.compatibility.featureAnalysis.featuresUsed,
    warnings: compiled.ir.compatibility.warnings,
    supports: supportsFromCompiled(compiled),
    fidelityClass:
      options.expectedFidelityClass ??
      compiled.ir.compatibility.parity.fidelityClass,
    visualEvidenceTier:
      options.visualEvidenceTier ??
      compiled.ir.compatibility.parity.visualEvidenceTier,
    evidence: compiled.ir.compatibility.parity.evidence,
    certification: options.certification ?? 'exploratory',
    corpusTier: options.corpusTier ?? 'exploratory',
    parity: compiled.ir.compatibility.parity,
    bundledFile: options.bundledFile,
  };
}

export function createMilkdropCatalogStore({
  dbName = 'stims-milkdrop',
  catalogUrl = '/milkdrop-presets/catalog.json',
}: {
  dbName?: string;
  catalogUrl?: string;
} = {}): MilkdropCatalogStore {
  const memoryPresets = new Map<string, StoredPresetRecord>();
  const memoryMeta = new Map<string, StoredMetaRecord>();
  const bundledSourceCache = new Map<string, MilkdropPresetSource>();
  const analysisCache = new Map<string, MilkdropCompiledPreset>();
  const analysisOptionsKey = 'compat';
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let bundledCatalogPromise: Promise<MilkdropBundledCatalogEntry[]> | null =
    null;

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openDbWithTimeout(dbName).catch(() => null);
    }
    return dbPromise;
  };

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
          const defaultFidelityClass = document.expectedFidelityClass;
          const defaultVisualEvidenceTier = document.visualEvidenceTier;
          return (document.presets ?? []).map((entry) => ({
            id: entry.id,
            title: entry.title,
            author: entry.author,
            file: entry.file,
            tags: entry.tags,
            curatedRank: entry.curatedRank ?? entry.order,
            certification: entry.certification ?? defaultCertification,
            corpusTier: entry.corpusTier ?? defaultCorpusTier,
            expectedFidelityClass:
              entry.expectedFidelityClass ?? defaultFidelityClass,
            visualEvidenceTier:
              entry.visualEvidenceTier ?? defaultVisualEvidenceTier,
            supports: entry.supports ?? entry.compatibility,
          }));
        })
        .catch(() => [] as MilkdropBundledCatalogEntry[]);
    }
    return bundledCatalogPromise;
  };

  const readMeta = async (id: string) => {
    const db = await getDb();
    if (!db) {
      return memoryMeta.get(id) ?? null;
    }
    return getRecord<StoredMetaRecord>(db, 'meta', id);
  };

  const writeMeta = async (record: StoredMetaRecord) => {
    const db = await getDb();
    if (!db) {
      memoryMeta.set(record.id, record);
      return;
    }
    await putRecord(db, 'meta', record);
  };

  const getHistoryRecord = async () =>
    (await readMeta(HISTORY_RECORD_ID)) ?? { id: HISTORY_RECORD_ID, stack: [] };

  const getCompiled = (source: MilkdropPresetSource) => {
    const cacheKey = `${analysisOptionsKey}:${source.id}:${source.updatedAt ?? 0}:${source.raw}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const compiled = compileMilkdropPresetSource(source.raw, source);
    analysisCache.set(cacheKey, compiled);
    return compiled;
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
    async listPresets() {
      const [bundled, db, historyRecord] = await Promise.all([
        getBundledCatalog(),
        getDb(),
        getHistoryRecord(),
      ]);
      const storedPresets = db
        ? await getAllRecords<StoredPresetRecord>(db, 'presets')
        : [...memoryPresets.values()];
      const storedMeta = db
        ? await getAllRecords<StoredMetaRecord>(db, 'meta')
        : [...memoryMeta.values()];
      const metaById = new Map(storedMeta.map((record) => [record.id, record]));
      const history = historyRecord.stack ?? [];

      const bundledEntries = await Promise.all(
        bundled.map(async (entry) => {
          try {
            const source = await loadBundledSource(entry);
            const compiled = getCompiled(source);
            return toCatalogEntry(
              source,
              compiled,
              metaById.get(entry.id) ?? null,
              {
                tags: entry.tags ?? [],
                curatedRank: entry.curatedRank,
                bundledFile: entry.file,
                historyIndex: history.indexOf(entry.id),
                certification: entry.certification ?? 'bundled',
                corpusTier: entry.corpusTier ?? 'bundled',
                expectedFidelityClass: entry.expectedFidelityClass,
                visualEvidenceTier: entry.visualEvidenceTier,
              },
            );
          } catch {
            return {
              id: entry.id,
              title: entry.title,
              author: entry.author,
              origin: 'bundled' as const,
              tags: entry.tags ?? [],
              curatedRank: entry.curatedRank,
              isFavorite: Boolean(metaById.get(entry.id)?.favorite),
              rating: metaById.get(entry.id)?.rating ?? 0,
              lastOpenedAt: metaById.get(entry.id)?.lastOpenedAt,
              updatedAt: undefined,
              historyIndex: history.indexOf(entry.id),
              featuresUsed: [],
              warnings: ['Bundled preset could not be analyzed.'],
              supports: {
                webgl: {
                  status:
                    entry.supports?.webgl === false ? 'unsupported' : 'partial',
                  reasons: ['Bundled preset could not be analyzed.'],
                  requiredFeatures: [],
                  unsupportedFeatures: [],
                },
                webgpu: {
                  status:
                    entry.supports?.webgpu === false
                      ? 'unsupported'
                      : 'partial',
                  reasons: ['Bundled preset could not be analyzed.'],
                  requiredFeatures: [],
                  unsupportedFeatures: [],
                  recommendedFallback: 'webgl',
                },
              },
              fidelityClass: entry.expectedFidelityClass ?? 'fallback',
              visualEvidenceTier: entry.visualEvidenceTier ?? 'none',
              evidence: {
                compile: 'issues',
                runtime: 'not-run',
                visual: 'not-captured',
              },
              certification: entry.certification ?? 'bundled',
              corpusTier: entry.corpusTier ?? 'bundled',
              parity: {
                ignoredFields: [],
                approximatedShaderLines: [],
                missingAliasesOrFunctions: [],
                backendDivergence: [],
                visualFallbacks: [],
                blockedConstructs: [],
                blockingConstructDetails: [],
                degradationReasons: [
                  {
                    code: 'backend-unsupported',
                    category: 'backend-degradation',
                    message: 'Bundled preset could not be analyzed.',
                    system: 'compiler',
                    blocking: true,
                  },
                ],
                fidelityClass: entry.expectedFidelityClass ?? 'fallback',
                evidence: {
                  compile: 'issues',
                  runtime: 'not-run',
                  visual: 'not-captured',
                },
                visualEvidenceTier: entry.visualEvidenceTier ?? 'none',
              },
              bundledFile: entry.file,
            } satisfies MilkdropCatalogEntry;
          }
        }),
      );

      const customEntries = storedPresets.map((entry) => {
        const compiled = getCompiled(entry);
        return toCatalogEntry(entry, compiled, metaById.get(entry.id) ?? null, {
          tags: ['custom'],
          historyIndex: history.indexOf(entry.id),
          certification: entry.origin === 'bundled' ? 'bundled' : 'exploratory',
          corpusTier: entry.origin === 'bundled' ? 'bundled' : 'exploratory',
        });
      });

      return [...bundledEntries, ...customEntries].sort((left, right) => {
        if (left.isFavorite !== right.isFavorite) {
          return left.isFavorite ? -1 : 1;
        }
        if (
          (left.historyIndex ?? Number.MAX_SAFE_INTEGER) !==
          (right.historyIndex ?? Number.MAX_SAFE_INTEGER)
        ) {
          return (
            (left.historyIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.historyIndex ?? Number.MAX_SAFE_INTEGER)
          );
        }
        if ((left.lastOpenedAt ?? 0) !== (right.lastOpenedAt ?? 0)) {
          return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0);
        }
        if (left.rating !== right.rating) {
          return right.rating - left.rating;
        }
        if (
          (left.curatedRank ?? Number.MAX_SAFE_INTEGER) !==
          (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
        ) {
          return (
            (left.curatedRank ?? Number.MAX_SAFE_INTEGER) -
            (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return left.title.localeCompare(right.title);
      });
    },

    async getPresetSource(id) {
      const db = await getDb();
      const stored = db
        ? await getRecord<StoredPresetRecord>(db, 'presets', id)
        : (memoryPresets.get(id) ?? null);
      if (stored) {
        return stored;
      }

      const bundled = await getBundledCatalog();
      const entry = bundled.find((candidate) => candidate.id === id);
      if (!entry) {
        return null;
      }
      return loadBundledSource(entry);
    },

    async savePreset(source) {
      const resolved = {
        ...source,
        id: source.id || `${slugify(source.title)}-${Date.now()}`,
        updatedAt: source.updatedAt ?? Date.now(),
      };
      const db = await getDb();
      if (!db) {
        memoryPresets.set(resolved.id, resolved);
        return resolved;
      }
      await putRecord(db, 'presets', resolved);
      return resolved;
    },

    async deletePreset(id) {
      const db = await getDb();
      if (!db) {
        memoryPresets.delete(id);
        memoryMeta.delete(id);
      } else {
        await deleteRecord(db, 'presets', id);
        await deleteRecord(db, 'meta', id);
      }
      const history = await getHistoryRecord();
      const nextStack = (history.stack ?? []).filter((entry) => entry !== id);
      await writeMeta({
        ...history,
        stack: nextStack,
      });
    },

    async saveDraft(id, raw) {
      const current = (await readMeta(id)) ?? { id };
      await writeMeta({ ...current, draft: raw });
    },

    async getDraft(id) {
      return (await readMeta(id))?.draft ?? null;
    },

    async setFavorite(id, favorite) {
      const current = (await readMeta(id)) ?? { id };
      await writeMeta({ ...current, favorite });
    },

    async setRating(id, rating) {
      const current = (await readMeta(id)) ?? { id };
      await writeMeta({ ...current, rating: clampRating(rating) });
    },

    async recordRecent(id) {
      const current = (await readMeta(id)) ?? { id };
      await writeMeta({ ...current, lastOpenedAt: Date.now() });
    },

    async pushHistory(id) {
      const current = await getHistoryRecord();
      const nextStack = [
        id,
        ...(current.stack ?? []).filter((entry) => entry !== id),
      ].slice(0, 32);
      await writeMeta({
        ...current,
        stack: nextStack,
      });
    },

    async getHistory() {
      return (await getHistoryRecord()).stack ?? [];
    },
  };
}

function clampRating(value: number) {
  return Math.min(5, Math.max(0, Math.round(value)));
}
