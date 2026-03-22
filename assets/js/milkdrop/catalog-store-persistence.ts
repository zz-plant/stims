import type { MilkdropPresetSource } from './types';

export type StoredPresetRecord = MilkdropPresetSource;

export type StoredMetaRecord = {
  id: string;
  favorite?: boolean;
  rating?: number;
  lastOpenedAt?: number;
  draft?: string;
  stack?: string[];
};

const DB_OPEN_TIMEOUT_MS = 750;

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

export function openDbWithTimeout(
  name: string,
  timeoutMs = DB_OPEN_TIMEOUT_MS,
) {
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

export async function getAllRecords<T>(
  db: IDBDatabase | null,
  storeName: string,
) {
  if (!db) {
    return [] as T[];
  }
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const records = await requestToPromise(store.getAll() as IDBRequest<T[]>);
  await transactionDone(transaction);
  return records;
}

export async function getRecord<T>(
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

export async function putRecord<T extends { id: string }>(
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

export async function deleteRecord(
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

export function createCatalogPersistence({ dbName }: { dbName: string }) {
  const memoryPresets = new Map<string, StoredPresetRecord>();
  const memoryMeta = new Map<string, StoredMetaRecord>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openDbWithTimeout(dbName).catch(() => null);
    }
    return dbPromise;
  };

  return {
    async listPresets() {
      const db = await getDb();
      return db
        ? getAllRecords<StoredPresetRecord>(db, 'presets')
        : [...memoryPresets.values()];
    },

    async getPreset(id: string) {
      const db = await getDb();
      return db
        ? getRecord<StoredPresetRecord>(db, 'presets', id)
        : (memoryPresets.get(id) ?? null);
    },

    async savePreset(record: StoredPresetRecord) {
      const db = await getDb();
      if (!db) {
        memoryPresets.set(record.id, record);
        return;
      }
      await putRecord(db, 'presets', record);
    },

    async deletePreset(id: string) {
      const db = await getDb();
      if (!db) {
        memoryPresets.delete(id);
        memoryMeta.delete(id);
        return;
      }
      await deleteRecord(db, 'presets', id);
      await deleteRecord(db, 'meta', id);
    },

    async listMeta() {
      const db = await getDb();
      return db
        ? getAllRecords<StoredMetaRecord>(db, 'meta')
        : [...memoryMeta.values()];
    },

    async readMeta(id: string) {
      const db = await getDb();
      return db
        ? getRecord<StoredMetaRecord>(db, 'meta', id)
        : (memoryMeta.get(id) ?? null);
    },

    async writeMeta(record: StoredMetaRecord) {
      const db = await getDb();
      if (!db) {
        memoryMeta.set(record.id, record);
        return;
      }
      await putRecord(db, 'meta', record);
    },
  };
}
