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

const DB_VERSION = 2;
const DB_OPEN_TIMEOUT_MS = 300;

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

function migrateStoreToV2(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  storeName: string,
) {
  if (!db.objectStoreNames.contains(storeName)) {
    db.createObjectStore(storeName, { keyPath: 'id' });
    return;
  }
  if (!transaction) {
    return;
  }
  // Rebuild the store on the v2 keyPath, carrying every record that still
  // fits the schema — these stores hold user-authored presets, so a plain
  // deleteObjectStore would destroy them.
  const readBack = transaction.objectStore(storeName).getAll();
  readBack.onsuccess = () => {
    db.deleteObjectStore(storeName);
    const rebuilt = db.createObjectStore(storeName, { keyPath: 'id' });
    for (const record of readBack.result as Array<{ id?: unknown }>) {
      if (record && typeof record.id === 'string') {
        try {
          rebuilt.put(record);
        } catch {
          // Skip the record the new schema cannot hold; keep the rest.
        }
      }
    }
  };
}

function openDb(name: string) {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 2) {
        migrateStoreToV2(db, request.transaction, 'presets');
        migrateStoreToV2(db, request.transaction, 'meta');
      }
      // Future: if (event.oldVersion < 3) { /* migrate v2 → v3 */ }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error;
      if (error?.name === 'QuotaExceededError') {
        console.warn(
          '[catalog-store] IndexedDB open failed: storage quota exceeded',
        );
      }
      reject(error);
    };
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
  // Holds records that could not be persisted (DB still opening, open failed,
  // or a write failed). Entries here are always newer than their DB
  // counterparts, so reads must prefer them.
  const memoryPresets = new Map<string, StoredPresetRecord>();
  const memoryMeta = new Map<string, StoredMetaRecord>();
  let openPromise: Promise<IDBDatabase | null> | null = null;
  let adoptedDb: IDBDatabase | null = null;

  const warnWriteFailure = (what: string, error: unknown) => {
    const name = error instanceof DOMException ? error.name : String(error);
    const detail =
      name === 'QuotaExceededError'
        ? 'storage is full — delete unused custom presets to free space'
        : name;
    console.warn(
      `[catalog-store] Could not persist ${what}; keeping it in memory for this session (${detail})`,
    );
  };

  const flushMemory = async (db: IDBDatabase) => {
    for (const [id, record] of [...memoryPresets]) {
      try {
        await putRecord(db, 'presets', record);
        memoryPresets.delete(id);
      } catch (error) {
        warnWriteFailure('preset', error);
        return;
      }
    }
    for (const [id, record] of [...memoryMeta]) {
      try {
        await putRecord(db, 'meta', record);
        memoryMeta.delete(id);
      } catch (error) {
        warnWriteFailure('preset metadata', error);
        return;
      }
    }
  };

  const startOpen = () => {
    if (!openPromise) {
      openPromise = openDb(dbName)
        .then(async (db) => {
          adoptedDb = db;
          if (db && (memoryPresets.size > 0 || memoryMeta.size > 0)) {
            await flushMemory(db);
          }
          return db;
        })
        .catch((error: unknown) => {
          console.warn(
            '[catalog-store] IndexedDB unavailable; changes will not persist beyond this session:',
            error instanceof DOMException ? error.name : error,
          );
          return null;
        });
    }
    return openPromise;
  };

  // Callers get the DB if it opens within the timeout and null otherwise, but
  // the open attempt itself is never abandoned: once it lands, later calls
  // adopt it and any writes stranded in memory are flushed into it.
  const getDb = () => {
    const pending = startOpen();
    if (adoptedDb) {
      return Promise.resolve<IDBDatabase | null>(adoptedDb);
    }
    return Promise.race([
      pending,
      new Promise<null>((resolve) => {
        globalThis.setTimeout(() => resolve(null), DB_OPEN_TIMEOUT_MS);
      }),
    ]);
  };

  return {
    async listPresets() {
      const db = await getDb();
      let stored: StoredPresetRecord[] = [];
      try {
        stored = await getAllRecords<StoredPresetRecord>(db, 'presets');
      } catch (error) {
        warnWriteFailure('preset list read', error);
      }
      if (memoryPresets.size === 0) {
        return stored;
      }
      const merged = new Map<string, StoredPresetRecord>();
      for (const record of stored) {
        merged.set(record.id, record);
      }
      for (const [id, record] of memoryPresets) {
        merged.set(id, record);
      }
      return [...merged.values()];
    },

    async getPreset(id: string) {
      const fromMemory = memoryPresets.get(id);
      if (fromMemory) {
        return fromMemory;
      }
      const db = await getDb();
      try {
        return await getRecord<StoredPresetRecord>(db, 'presets', id);
      } catch {
        return null;
      }
    },

    async savePreset(record: StoredPresetRecord) {
      const db = await getDb();
      if (db) {
        try {
          await putRecord(db, 'presets', record);
          memoryPresets.delete(record.id);
          return;
        } catch (error) {
          warnWriteFailure('preset', error);
        }
      }
      memoryPresets.set(record.id, record);
    },

    async deletePreset(id: string) {
      memoryPresets.delete(id);
      memoryMeta.delete(id);
      const db = await getDb();
      if (!db) {
        return;
      }
      try {
        await deleteRecord(db, 'presets', id);
        await deleteRecord(db, 'meta', id);
      } catch (error) {
        warnWriteFailure('preset deletion', error);
      }
    },

    async listMeta() {
      const db = await getDb();
      let stored: StoredMetaRecord[] = [];
      try {
        stored = await getAllRecords<StoredMetaRecord>(db, 'meta');
      } catch (error) {
        warnWriteFailure('preset metadata read', error);
      }
      if (memoryMeta.size === 0) {
        return stored;
      }
      const merged = new Map<string, StoredMetaRecord>();
      for (const record of stored) {
        merged.set(record.id, record);
      }
      for (const [id, record] of memoryMeta) {
        merged.set(id, record);
      }
      return [...merged.values()];
    },

    async readMeta(id: string) {
      const fromMemory = memoryMeta.get(id);
      if (fromMemory) {
        return fromMemory;
      }
      const db = await getDb();
      try {
        return await getRecord<StoredMetaRecord>(db, 'meta', id);
      } catch {
        return null;
      }
    },

    async writeMeta(record: StoredMetaRecord) {
      const db = await getDb();
      if (db) {
        try {
          await putRecord(db, 'meta', record);
          memoryMeta.delete(record.id);
          return;
        } catch (error) {
          warnWriteFailure('preset metadata', error);
        }
      }
      memoryMeta.set(record.id, record);
    },
  };
}
