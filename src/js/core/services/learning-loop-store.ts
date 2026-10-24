/**
 * LL-00: a bounded, local-only record of one learning-loop run.
 *
 * An episode connects an intent to a source change, its evidence, and an
 * outcome. A search history entry or an embedding alone is insufficient — the
 * learning-loop spec requires an explicit outcome (proposal shown, applied,
 * accepted, rejected, reverted), with unreviewed as the default.
 *
 * The store is deliberately small: at most `LEARNING_LOOP_EPISODE_LIMIT`
 * episodes and `LEARNING_LOOP_BYTE_LIMIT` bytes per browser, including stored
 * source and derived vectors. Raw captured media is transient by default and
 * is never stored here; retaining a reference image is an explicit choice
 * that counts toward the limit.
 *
 * Failure discipline: a full or unavailable store must leave editing usable
 * and show that the outcome was not saved. Writes that cannot reach the
 * durable backend land in an in-memory map for the session and report
 * `persisted: false`, so callers can say "not saved to this device".
 *
 * This module is dependency-free (no frontend imports) so it can be used by
 * scripts and tests as well as the app.
 */

/** Bump when the episode schema or eviction policy changes incompatibly. */
export const LEARNING_LOOP_SCHEMA_VERSION = 1 as const;

/** Pilot limit from the learning-loop spec: at most 100 episodes per browser. */
export const LEARNING_LOOP_EPISODE_LIMIT = 100 as const;

/** Pilot limit from the learning-loop spec: at most 32 MiB of episode data. */
export const LEARNING_LOOP_BYTE_LIMIT = 32 * 1024 * 1024;

const DB_NAME = 'stims:learning-loops';
const EPISODE_STORE = 'episodes';
const META_STORE = 'meta';
const SCHEMA_KEY = 'schema';
const DB_OPEN_TIMEOUT_MS = 300;

export type EpisodeOutcomeKind =
  | 'proposal-shown'
  | 'applied'
  | 'accepted'
  | 'rejected'
  | 'reverted';

export type EpisodeOutcomeEvent = {
  kind: EpisodeOutcomeKind;
  /** ISO timestamp of the event. */
  at: string;
  /** User-selected reason when supplied; weak signals stay separate. */
  reason?: string;
};

/** Whether an annotation (preserve property, reference choice) came from a
 * person, a model, or an instrument. Distinguishing them is part of the
 * record; they are never merged into one "the user wanted this". */
export type AnnotationSource = 'user' | 'model' | 'instrument';

export type EpisodeAnnotation = {
  label: string;
  source: AnnotationSource;
};

/** Which learning loop produced this episode. Slice 1 ships
 * `reference-remix` (LL-01's retrieval half); other loops append. */
export type LearningLoopId = 'reference-remix' | string;

/** A single bounded reference retrieval + outcome, per the LL-00 contract. */
export type LearningLoopEpisode = {
  /** The record's own schema version; must equal LEARNING_LOOP_SCHEMA_VERSION. */
  schemaVersion: 1;
  id: string;
  loop: LearningLoopId;
  /** Reusing an accepted episode links the new run to it. */
  parentEpisodeId?: string;
  createdAt: string;
  /** Local session id; episodes never leave the device without consent. */
  sessionId: string;
  intent: {
    /** The user's request, verbatim. */
    request: string;
    /** Explicit properties to preserve ("keep the tunnel"). */
    preserve?: string[];
    annotations: EpisodeAnnotation[];
    /** Content-addressed reference artifacts (the reference image, etc.). */
    referenceArtifactIds?: string[];
  };
  /** Source change; absent for a retrieval-only run that never patched. */
  source?: {
    beforeHash?: string;
    afterHash?: string;
    sourceRefs: string[];
    proposedDiff?: string;
    toolchainVersion?: string;
    /** Source revision expected at apply time; a mismatch blocks Apply. */
    expectedRevision?: string;
  };
  /** Content-addressed evidence references; unknown fields stay unknown. */
  evidence?: {
    artifactIds: string[];
    backend?: 'webgl' | 'webgpu' | 'unknown';
    viewport?: string;
    audioScenario?: string;
  };
  /** Bounded model receipt when a hosted judgment was used. */
  modelReceipt?: {
    provider: string;
    model: string;
    questionVersion: string;
    inputHash?: string;
    disposition?: 'accepted' | 'review';
    failure?: string;
  };
  /** Explicit outcome events; unreviewed is the default (empty outcomes). */
  outcomes: EpisodeOutcomeEvent[];
  ownership: {
    origin: 'local' | 'reviewed-public';
    /** Consent to retain artifacts (the reference image) on this device. */
    retainedConsent: boolean;
  };
  /** Slice-1 reference. Kept minimal; richer references arrive with LL-08. */
  reference: {
    kind: 'description' | 'image';
    description: string;
    /** Set when the reference is an image retained with consent; the payload
     * lives under the same key in `artifacts`. */
    imageArtifactId?: string;
  };
  /** Owned artifacts (a retained reference image). Eviction removes them
   * with the episode; shared artifacts use reference counts, which slice 1
   * does not need. */
  artifacts?: Record<string, string>;
};

export type EpisodeWriteResult =
  | { persisted: true; evictedCount: number }
  | { persisted: false; reason: 'quota' | 'unavailable' };

export interface EpisodeStore {
  list(): Promise<LearningLoopEpisode[]>;
  get(id: string): Promise<LearningLoopEpisode | null>;
  /** Insert or replace one episode, evicting oldest when over the limits.
   * `persisted: false` means the durable backend could not take it (quota or
   * unavailable); callers surface "outcome not saved" without failing the
   * editing workflow. */
  put(episode: LearningLoopEpisode): Promise<EpisodeWriteResult>;
  /** Append one outcome event and persist the episode again. */
  appendOutcome(
    id: string,
    event: EpisodeOutcomeEvent,
  ): Promise<EpisodeWriteResult>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** Approximate durable bytes of one episode (JSON envelope + one separator). */
export function episodeBytes(episode: LearningLoopEpisode): number {
  return new TextEncoder().encode(JSON.stringify(episode)).length + 1;
}

export function newEpisodeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One random session id per store instance; episodes share it until reload. */
export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ses-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Eviction: oldest first (by createdAt, then id), removing every owned
 * artifact with the episode. Keeps a single episode that alone exceeds the
 * byte limit — dropping everything would hide the outcome entirely, which the
 * failure discipline forbids. Returns the ids removed and the surviving list. */
export function evictToBudget(
  episodes: LearningLoopEpisode[],
  limit = LEARNING_LOOP_EPISODE_LIMIT,
  byteLimit = LEARNING_LOOP_BYTE_LIMIT,
): { kept: LearningLoopEpisode[]; evicted: string[] } {
  const byAge = [...episodes].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  let bytes = byAge.reduce((sum, episode) => sum + episodeBytes(episode), 0);
  let kept = byAge;
  const evicted: string[] = [];
  while ((kept.length > limit || bytes > byteLimit) && kept.length > 1) {
    const oldest = kept[0];
    if (!oldest) break;
    bytes -= episodeBytes(oldest);
    evicted.push(oldest.id);
    kept = kept.slice(1);
  }
  return { kept, evicted };
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

function openDb(name: string, version: number) {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve<IDBDatabase | null>(null);
  }
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EPISODE_STORE)) {
        db.createObjectStore(EPISODE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(db: IDBDatabase | null, storeName: string) {
  if (!db) return [] as T[];
  const transaction = db.transaction(storeName, 'readonly');
  const records = await requestToPromise(
    transaction.objectStore(storeName).getAll() as IDBRequest<T[]>,
  );
  await transactionDone(transaction);
  return records;
}

async function readOne<T>(
  db: IDBDatabase | null,
  storeName: string,
  key: string,
) {
  if (!db) return null as T | null;
  const transaction = db.transaction(storeName, 'readonly');
  const record = await requestToPromise(
    transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>,
  );
  await transactionDone(transaction);
  return record ?? null;
}

async function writeOne(
  db: IDBDatabase | null,
  storeName: string,
  record: unknown,
) {
  if (!db) return;
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(record);
  await transactionDone(transaction);
}

async function removeOne(
  db: IDBDatabase | null,
  storeName: string,
  key: string,
) {
  if (!db) return;
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

/** Pure in-memory store: the test backend and the fallback for environments
 * without IndexedDB (scripts, workers, browsers with storage disabled). */
export class MemoryEpisodeStore implements EpisodeStore {
  private readonly episodes = new Map<string, LearningLoopEpisode>();

  async list() {
    return [...this.episodes.values()];
  }

  async get(id: string) {
    return this.episodes.get(id) ?? null;
  }

  async put(episode: LearningLoopEpisode) {
    this.episodes.set(episode.id, episode);
    const { kept, evicted } = evictToBudget([...this.episodes.values()]);
    this.episodes.clear();
    for (const entry of kept) this.episodes.set(entry.id, entry);
    return { persisted: true as const, evictedCount: evicted.length };
  }

  async appendOutcome(id: string, event: EpisodeOutcomeEvent) {
    const episode = this.episodes.get(id);
    if (!episode)
      return { persisted: false as const, reason: 'unavailable' as const };
    episode.outcomes = [...episode.outcomes, event];
    return this.put(episode);
  }

  async delete(id: string) {
    return this.episodes.delete(id);
  }

  async clear() {
    this.episodes.clear();
  }
}

/**
 * IndexedDB-backed store with an in-memory fallback, mirroring the
 * catalog-store persistence pattern: writes that cannot reach the durable
 * backend stay in memory for the session and report `persisted: false`.
 *
 * Schema migrations are explicit: on a version mismatch the old records are
 * deleted and the store is rebuilt, satisfying the requirement that
 * migrations never strand un-deletable old records.
 */
export function createIndexedDbEpisodeStore(): EpisodeStore {
  const memory = new Map<string, LearningLoopEpisode>();
  let openPromise: Promise<IDBDatabase | null> | null = null;
  let adoptedDb: IDBDatabase | null = null;

  const startOpen = () => {
    openPromise ??= (async () => {
      const db = await openDb(DB_NAME, LEARNING_LOOP_SCHEMA_VERSION);
      if (!db) return null;
      try {
        const storedSchema = await readOne<{ version: number }>(
          db,
          META_STORE,
          SCHEMA_KEY,
        );
        if (storedSchema?.version !== LEARNING_LOOP_SCHEMA_VERSION) {
          // Explicit migration: delete old records, then stamp the new schema.
          await clearRecords(db);
          await writeOne(db, META_STORE, {
            id: SCHEMA_KEY,
            version: LEARNING_LOOP_SCHEMA_VERSION,
          });
        }
      } catch {
        // Schema read failed; leave the store alone rather than deleting
        // user records on a transient error.
      }
      adoptedDb = db;
      return db;
    })().catch((error: unknown) => {
      console.warn(
        '[learning-loop-store] IndexedDB unavailable; outcomes will not persist beyond this session:',
        error instanceof DOMException ? error.name : error,
      );
      return null;
    });
    return openPromise;
  };

  const getDb = () => {
    const pending = startOpen();
    if (adoptedDb) return Promise.resolve<IDBDatabase | null>(adoptedDb);
    return Promise.race([
      pending,
      new Promise<null>((resolve) => {
        globalThis.setTimeout(() => resolve(null), DB_OPEN_TIMEOUT_MS);
      }),
    ]);
  };

  const warnWriteFailure = (what: string, error: unknown) => {
    const name = error instanceof DOMException ? error.name : String(error);
    console.warn(
      `[learning-loop-store] Could not persist ${what}; keeping it in memory for this session (${name})`,
    );
  };

  async function listFromBackend(): Promise<LearningLoopEpisode[]> {
    const db = await getDb();
    let stored: LearningLoopEpisode[] = [];
    if (db) {
      try {
        stored = await readAll<LearningLoopEpisode>(db, EPISODE_STORE);
      } catch (error) {
        warnWriteFailure('episode list read', error);
      }
    }
    if (memory.size === 0) return stored;
    const merged = new Map<string, LearningLoopEpisode>();
    for (const record of stored) merged.set(record.id, record);
    for (const [id, record] of memory) merged.set(id, record);
    return [...merged.values()];
  }

  return {
    async list() {
      return listFromBackend();
    },

    async get(id: string) {
      const fromMemory = memory.get(id);
      if (fromMemory) return fromMemory;
      const db = await getDb();
      if (!db) return null;
      try {
        return await readOne<LearningLoopEpisode>(db, EPISODE_STORE, id);
      } catch {
        return null;
      }
    },

    async put(episode: LearningLoopEpisode) {
      const all = await listFromBackend();
      const withNew = [
        ...all.filter((entry) => entry.id !== episode.id),
        episode,
      ];
      const { kept, evicted } = evictToBudget(withNew);
      const db = await getDb();
      if (!db) {
        memory.set(episode.id, episode);
        for (const id of evicted) memory.delete(id);
        return { persisted: false as const, reason: 'unavailable' as const };
      }
      try {
        // Remove evicted records and write the surviving set.
        const transaction = db.transaction(EPISODE_STORE, 'readwrite');
        const store = transaction.objectStore(EPISODE_STORE);
        for (const id of evicted) store.delete(id);
        for (const record of kept) store.put(record);
        await transactionDone(transaction);
        for (const id of evicted) memory.delete(id);
        memory.delete(episode.id);
        return { persisted: true as const, evictedCount: evicted.length };
      } catch (error) {
        warnWriteFailure('episode', error);
        memory.set(episode.id, episode);
        for (const id of evicted) memory.delete(id);
        return { persisted: false as const, reason: 'quota' as const };
      }
    },

    async appendOutcome(id: string, event: EpisodeOutcomeEvent) {
      const episode = await this.get(id);
      if (!episode) {
        return { persisted: false as const, reason: 'unavailable' as const };
      }
      episode.outcomes = [...episode.outcomes, event];
      return this.put(episode);
    },

    async delete(id: string) {
      memory.delete(id);
      const db = await getDb();
      if (!db) return true;
      try {
        await removeOne(db, EPISODE_STORE, id);
        return true;
      } catch (error) {
        warnWriteFailure('episode deletion', error);
        return false;
      }
    },

    async clear() {
      memory.clear();
      const db = await getDb();
      if (!db) return;
      try {
        await clearRecords(db);
      } catch (error) {
        warnWriteFailure('episode clear', error);
      }
    },
  };
}

async function clearRecords(db: IDBDatabase) {
  const transaction = db.transaction([EPISODE_STORE, META_STORE], 'readwrite');
  transaction.objectStore(EPISODE_STORE).clear();
  transaction.objectStore(META_STORE).clear();
  await transactionDone(transaction);
}

/** The store the app uses; a memory store when IndexedDB is unavailable. */
export function createLearningLoopStore(): EpisodeStore {
  if (typeof indexedDB === 'undefined') {
    return new MemoryEpisodeStore();
  }
  return createIndexedDbEpisodeStore();
}

/** Test seam: forget the memoized module-level state between cases. */
export function resetLearningLoopStore(): void {}
