import { compileMilkdropPresetSource } from '../compiler';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
} from '../types';
import { downloadPresetFile } from './persistence';
import { isEditablePreset } from './session';

export function createMilkdropPresetFileActions({
  catalogStore,
  getActiveCatalogEntry,
  getActiveCompiled,
  scheduleCatalogSync,
  selectPreset,
}: {
  catalogStore: MilkdropCatalogStore;
  getActiveCatalogEntry: () => MilkdropCatalogEntry | null;
  getActiveCompiled: () => MilkdropCompiledPreset;
  scheduleCatalogSync: () => Promise<void>;
  selectPreset: (
    id: string,
    options?: { recordHistory?: boolean },
  ) => Promise<void>;
}) {
  return {
    async importFiles(files: FileList) {
      for (const file of Array.from(files)) {
        const raw = await file.text();
        const compiled = compileMilkdropPresetSource(raw, {
          title: file.name.replace(/\.[^.]+$/u, ''),
          origin: 'imported',
        });
        const saved = await catalogStore.savePreset({
          id: `${compiled.source.id}-${Date.now()}`,
          title: compiled.title,
          raw,
          origin: 'imported',
          author: compiled.author,
          fileName: file.name,
        });
        await catalogStore.saveDraft(saved.id, compiled.formattedSource);
        await scheduleCatalogSync();
        await selectPreset(saved.id);
      }
    },

    async duplicatePreset() {
      const compiled = getActiveCompiled();
      const saved = await catalogStore.savePreset({
        id: `${compiled.source.id}-copy-${Date.now()}`,
        title: `${compiled.title} Copy`,
        raw: compiled.formattedSource,
        origin: 'user',
        author: compiled.author,
      });
      await scheduleCatalogSync();
      await selectPreset(saved.id);
    },

    async deleteActivePreset() {
      const entry = getActiveCatalogEntry();
      if (!entry || !isEditablePreset(entry)) {
        return;
      }
      const deletedId = entry.id;
      await catalogStore.deletePreset(deletedId);
      await scheduleCatalogSync();
      const replacement = getActiveCatalogEntry();
      const entries = await catalogStore.listPresets();
      const next =
        (replacement && replacement.id !== deletedId ? replacement : null) ??
        entries.find((candidate) => candidate.id !== deletedId) ??
        null;
      if (next) {
        await selectPreset(next.id, { recordHistory: false });
      }
    },

    exportPreset() {
      const compiled = getActiveCompiled();
      downloadPresetFile(compiled.source.id, compiled.formattedSource);
    },
  };
}
