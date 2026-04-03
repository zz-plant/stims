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
  toCatalogEntry,
  toUnavailableBundledCatalogEntry,
} from './catalog-store-projection';
import type { MilkdropCatalogStore, MilkdropPresetSource } from './types';

const HISTORY_RECORD_ID = '__history__';

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
}: {
  dbName?: string;
  catalogUrl?: string;
  libraryManifestUrls?: string[];
} = {}): MilkdropCatalogStore {
  const persistence = createCatalogPersistence({ dbName });
  const bundledCatalog = createBundledCatalogLoader({
    catalogUrl,
    libraryManifestUrls,
  });
  const analysis = createCatalogAnalysis();

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

      const bundledEntries = await Promise.all(
        bundled.map(async (entry) => {
          const meta = metaById.get(entry.id) ?? null;
          const historyIndex = history.indexOf(entry.id);

          try {
            const source = await bundledCatalog.loadBundledSource(entry);
            const compiled = analysis.getCompiled(source);
            const validatedOverrides = getValidatedCatalogOverrides(
              entry,
              compiled,
            );
            return toCatalogEntry(source, compiled, meta, {
              tags: entry.tags ?? [],
              curatedRank: entry.curatedRank,
              bundledFile: entry.file,
              historyIndex,
              certification: entry.certification ?? 'bundled',
              corpusTier: entry.corpusTier ?? 'bundled',
              ...validatedOverrides,
            });
          } catch {
            return toUnavailableBundledCatalogEntry(entry, meta, historyIndex);
          }
        }),
      );

      const customEntries = storedPresets.map((entry) => {
        const compiled = analysis.getCompiled(entry);
        return toCatalogEntry(entry, compiled, metaById.get(entry.id) ?? null, {
          tags: ['custom'],
          historyIndex: history.indexOf(entry.id),
          certification: entry.origin === 'bundled' ? 'bundled' : 'exploratory',
          corpusTier: entry.origin === 'bundled' ? 'bundled' : 'exploratory',
        });
      });

      return sortMilkdropCatalogEntries([...bundledEntries, ...customEntries]);
    },

    async getPresetSource(id) {
      const stored = await persistence.getPreset(id);
      if (stored) {
        return stored;
      }

      const bundled = await bundledCatalog.getBundledCatalog();
      const entry = bundled.find((candidate) => candidate.id === id);
      if (!entry) {
        return null;
      }
      return bundledCatalog.loadBundledSource(entry);
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
