import { createLogger } from '../core/logger.ts';
import { sortMilkdropCatalogEntries } from './catalog-sort';
import {
  createCatalogAnalysis,
  getValidatedCatalogOverrides,
} from './catalog-store-analysis';
import { createBundledCatalogLoader } from './catalog-store-bundled-loader';
import {
  createCatalogPersistence,
  type StoredMetaRecord,
} from './catalog-store-persistence';
import {
  toBundledCatalogEntryFromManifest,
  toCatalogEntry,
} from './catalog-store-projection';
import type { compileMilkdropPresetSource } from './compiler';
import { resolvePresetCatalogEntry } from './preset-id-resolution';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropPresetSource,
} from './types';

const log = createLogger('CatalogStore');
const HISTORY_RECORD_ID = '__history__';

// The full-catalog load maps ~1800 bundled entries on the main thread right
// after the shell paints. A single synchronous pass blocks rendering for
// hundreds of milliseconds on mid-range hardware; yielding a macrotask every
// time a batch exceeds this budget keeps each contiguous chunk short.
const CATALOG_BATCH_TIME_BUDGET_MS = 24;

const yieldToMainThread = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'milkdrop-preset'
  );
}

export function createMilkdropCatalogStore({
  dbName = 'stims-milkdrop',
  catalogUrl = '/milkdrop-presets/catalog.json',
  libraryManifestUrls,
  compilePresetImpl,
}: {
  dbName?: string;
  catalogUrl?: string;
  libraryManifestUrls?: string[];
  compilePresetImpl?: typeof compileMilkdropPresetSource;
} = {}): MilkdropCatalogStore {
  const persistence = createCatalogPersistence({ dbName });
  const bundledCatalog = createBundledCatalogLoader({
    catalogUrl,
    libraryManifestUrls,
  });
  const analysis = createCatalogAnalysis({ compilePresetImpl });

  let prefetched = false;

  const getHistoryRecord = async () =>
    (await persistence.readMeta(HISTORY_RECORD_ID)) ?? {
      id: HISTORY_RECORD_ID,
      stack: [],
    };

  const writeMeta = (record: StoredMetaRecord) => persistence.writeMeta(record);

  return {
    async listPresets() {
      const [bundled, storedPresets, storedMeta, historyRecord] =
        await Promise.all([
          bundledCatalog.getBundledCatalog(),
          persistence.listPresets(),
          persistence.listMeta(),
          getHistoryRecord(),
        ]);
      const metaById = new Map(storedMeta.map((record) => [record.id, record]));
      const history = historyRecord.stack ?? [];
      const historyIndexMap = new Map<string, number>();
      for (let i = 0; i < history.length; i += 1) {
        historyIndexMap.set(history[i], i);
      }

      const bundledEntries: MilkdropCatalogEntry[] = [];
      let batchStart = performance.now();
      for (let i = 0; i < bundled.length; i += 1) {
        const entry = bundled[i];
        try {
          const meta = metaById.get(entry.id) ?? null;
          const historyIndex = historyIndexMap.get(entry.id) ?? -1;
          const cachedCompiled = analysis.getCachedCompiled(entry.id);

          if (cachedCompiled) {
            const validatedOverrides = getValidatedCatalogOverrides(
              entry,
              cachedCompiled,
            );
            bundledEntries.push(
              toCatalogEntry(cachedCompiled.source, cachedCompiled, meta, {
                tags: entry.tags ?? [],
                curatedRank: entry.curatedRank,
                bundledFile: entry.file,
                historyIndex,
                certification: entry.certification ?? 'bundled',
                corpusTier: entry.corpusTier ?? 'bundled',
                preview: entry.preview,
                ...validatedOverrides,
              }),
            );
          } else {
            bundledEntries.push(
              toBundledCatalogEntryFromManifest(entry, meta, historyIndex),
            );
          }
        } catch (error) {
          log.warn(
            `Skipping bundled preset "${entry.id}" (${entry.title}): failed to analyze`,
            error,
          );
        }
        if (performance.now() - batchStart >= CATALOG_BATCH_TIME_BUDGET_MS) {
          batchStart = performance.now();
          await yieldToMainThread();
        }
      }

      const customEntries: MilkdropCatalogEntry[] = [];
      for (let i = 0; i < storedPresets.length; i += 1) {
        const entry = storedPresets[i];
        try {
          const compiled = analysis.getCompiled(entry);
          customEntries.push(
            toCatalogEntry(entry, compiled, metaById.get(entry.id) ?? null, {
              tags: ['custom'],
              historyIndex: historyIndexMap.get(entry.id) ?? -1,
              certification:
                entry.origin === 'bundled' ? 'bundled' : 'exploratory',
              corpusTier:
                entry.origin === 'bundled' ? 'bundled' : 'exploratory',
            }),
          );
        } catch (error) {
          log.warn(
            `Skipping stored preset "${entry.id}" (${entry.title}): failed to compile`,
            error,
          );
        }
      }

      return sortMilkdropCatalogEntries([...bundledEntries, ...customEntries]);
    },

    async getPresetSource(id) {
      const normalizedId = id.trim();
      if (!normalizedId) {
        return null;
      }

      log.log(`${normalizedId}: checking IndexedDB`);
      const stored = await persistence.getPreset(normalizedId);
      if (stored) {
        log.log(
          `${normalizedId}: found in IndexedDB (origin: ${stored.origin})`,
        );
        return stored;
      }

      log.log(`${normalizedId}: not in IndexedDB, checking bundled`);
      const bundled = await bundledCatalog.getBundledCatalog();
      const bundledExactEntry =
        bundled.find((candidate) => candidate.id === normalizedId) ?? null;
      if (bundledExactEntry) {
        log.log(`${normalizedId}: found exact match in bundled`);
        const source =
          await bundledCatalog.loadBundledSource(bundledExactEntry);
        analysis.getCompiled(source);
        return source;
      }

      log.log(`${normalizedId}: no exact match, trying alias in stored`);
      const storedAliasMatch = resolvePresetCatalogEntry(
        await persistence.listPresets(),
        normalizedId,
      );
      if (storedAliasMatch) {
        log.log(
          `${normalizedId}: alias matched stored "${storedAliasMatch.id}"`,
        );
        return storedAliasMatch;
      }

      log.log(`${normalizedId}: trying alias in bundled`);
      const entry = resolvePresetCatalogEntry(bundled, normalizedId);
      if (!entry) {
        log.log(`${normalizedId}: not found in any source`);
        return null;
      }
      log.log(`${normalizedId}: alias matched bundled "${entry.id}"`);
      const source = await bundledCatalog.loadBundledSource(entry);
      analysis.getCompiled(source);
      return source;
    },

    async prefetchCompiledPresets(limit = 20) {
      if (prefetched) return;
      prefetched = true;

      // Each compile runs synchronously on this thread and can take tens of
      // milliseconds, so pacing matters: yielding only a macrotask between
      // ~1800 compiles kept the main thread saturated for minutes and froze
      // rendering and automation after catalog load. Limit prefetching to
      // the top curated presets and compile only inside idle budget.
      type IdleBudget = { timeRemaining(): number };
      const waitForIdle = (): Promise<IdleBudget | null> =>
        new Promise((resolve) => {
          const ric = (
            globalThis as {
              requestIdleCallback?: (
                callback: (deadline: IdleBudget) => void,
                options?: { timeout: number },
              ) => number;
            }
          ).requestIdleCallback;
          if (typeof ric === 'function') {
            ric((deadline) => resolve(deadline), { timeout: 1000 });
          } else {
            // requestIdleCallback fallback only (Safari) — approximates "one
            // frame has passed" at 30fps. Deliberately unrelated to
            // CATALOG_BATCH_TIME_BUDGET_MS above: that constant bounds a
            // synchronous mapping batch's length; this one paces a
            // completely different prefetch/compile loop when the real idle
            // API isn't available. Same file, different jobs — not a
            // mismatch to reconcile.
            setTimeout(() => resolve(null), 32);
          }
        });

      try {
        const bundled = await bundledCatalog.getBundledCatalog();
        const targetEntries = limit > 0 ? bundled.slice(0, limit) : bundled;
        let budget = await waitForIdle();
        for (const entry of targetEntries) {
          if (analysis.getCachedCompiled(entry.id)) continue;
          if (budget && budget.timeRemaining() < 10) {
            budget = await waitForIdle();
          }
          try {
            const source = await bundledCatalog.loadBundledSource(entry);
            analysis.getCompiled(source);
          } catch {
            // Skip presets that fail to load or compile
          }
          if (!budget) {
            budget = await waitForIdle();
          }
        }
      } catch {
        // If the bundled catalog itself fails, there is nothing to prefetch
      }
    },

    async savePreset(source) {
      const resolved: MilkdropPresetSource = {
        ...source,
        id: source.id || `${slugify(source.title)}-${Date.now()}`,
        updatedAt: source.updatedAt ?? Date.now(),
      };
      await persistence.savePreset(resolved);
      return resolved;
    },

    async deletePreset(id) {
      await persistence.deletePreset(id);
      const history = await getHistoryRecord();
      const nextStack = (history.stack ?? []).filter((entry) => entry !== id);
      await writeMeta({
        ...history,
        stack: nextStack,
      });
    },

    async saveDraft(id, raw) {
      const current = (await persistence.readMeta(id)) ?? { id };
      await writeMeta({ ...current, draft: raw });
    },

    async getDraft(id) {
      return (await persistence.readMeta(id))?.draft ?? null;
    },

    async setFavorite(id, favorite) {
      const current = (await persistence.readMeta(id)) ?? { id };
      await writeMeta({ ...current, favorite });
    },

    async setRating(id, rating) {
      const current = (await persistence.readMeta(id)) ?? { id };
      await writeMeta({ ...current, rating: clampRating(rating) });
    },

    async recordRecent(id) {
      const current = (await persistence.readMeta(id)) ?? { id };
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
