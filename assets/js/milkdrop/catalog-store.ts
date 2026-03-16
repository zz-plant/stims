import type {
  MilkdropBundledCatalogEntry,
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropPresetSource,
} from './types';

type StoredPresetRecord = MilkdropPresetSource;

type StoredMetaRecord = {
  id: string;
  favorite?: boolean;
  lastOpenedAt?: number;
  draft?: string;
};

type BundledCatalogDocument =
  | MilkdropBundledCatalogEntry[]
  | {
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
    const request = indexedDB.open(name, 1);
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

function toCatalogEntry(
  entry: MilkdropBundledCatalogEntry,
  meta: StoredMetaRecord | null,
): MilkdropCatalogEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    origin: 'bundled',
    tags: entry.tags ?? [],
    curatedRank: entry.curatedRank,
    isFavorite: Boolean(meta?.favorite),
    lastOpenedAt: meta?.lastOpenedAt,
    supports: {
      webgl: entry.supports?.webgl !== false,
      webgpu: entry.supports?.webgpu !== false,
    },
    bundledFile: entry.file,
  };
}

function toStoredEntry(
  entry: StoredPresetRecord,
  meta: StoredMetaRecord | null,
): MilkdropCatalogEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    origin: entry.origin,
    tags: ['custom'],
    isFavorite: Boolean(meta?.favorite),
    lastOpenedAt: meta?.lastOpenedAt,
    updatedAt: entry.updatedAt,
    supports: {
      webgl: true,
      webgpu: true,
    },
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
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let bundledCatalogPromise: Promise<MilkdropBundledCatalogEntry[]> | null =
    null;

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openDb(dbName).catch(() => null);
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
          return (document.presets ?? []).map((entry) => ({
            id: entry.id,
            title: entry.title,
            author: entry.author,
            file: entry.file,
            tags: entry.tags,
            curatedRank: entry.curatedRank ?? entry.order,
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

  return {
    async listPresets() {
      const [bundled, db] = await Promise.all([getBundledCatalog(), getDb()]);
      const storedPresets = db
        ? await getAllRecords<StoredPresetRecord>(db, 'presets')
        : [...memoryPresets.values()];
      const storedMeta = db
        ? await getAllRecords<StoredMetaRecord>(db, 'meta')
        : [...memoryMeta.values()];
      const metaById = new Map(storedMeta.map((record) => [record.id, record]));

      const bundledEntries = bundled.map((entry) =>
        toCatalogEntry(entry, metaById.get(entry.id) ?? null),
      );
      const customEntries = storedPresets.map((entry) =>
        toStoredEntry(entry, metaById.get(entry.id) ?? null),
      );

      return [...bundledEntries, ...customEntries].sort((left, right) => {
        if (left.isFavorite !== right.isFavorite) {
          return left.isFavorite ? -1 : 1;
        }
        if ((left.lastOpenedAt ?? 0) !== (right.lastOpenedAt ?? 0)) {
          return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0);
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

    async getPresetSource(id: string) {
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
      const raw = await loadText(entry.file);
      return {
        id: entry.id,
        title: entry.title,
        author: entry.author,
        raw,
        origin: 'bundled',
        path: entry.file,
      };
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
        return;
      }
      await deleteRecord(db, 'presets', id);
      await deleteRecord(db, 'meta', id);
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

    async recordRecent(id) {
      const current = (await readMeta(id)) ?? { id };
      await writeMeta({ ...current, lastOpenedAt: Date.now() });
    },
  };
}
