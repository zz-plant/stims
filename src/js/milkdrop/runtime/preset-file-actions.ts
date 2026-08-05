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
  setStatus,
}: {
  catalogStore: MilkdropCatalogStore;
  getActiveCatalogEntry: () => MilkdropCatalogEntry | null;
  getActiveCompiled: () => MilkdropCompiledPreset;
  scheduleCatalogSync: () => Promise<void>;
  selectPreset: (
    id: string,
    options?: { recordHistory?: boolean },
  ) => Promise<void>;
  setStatus?: (message: string) => void;
}) {
  return {
    async importFiles(files: FileList) {
      // One unreadable or malformed file must not discard the rest of the
      // batch, so each file imports independently and failures accumulate
      // into a summary.
      const skipped: Array<{ name: string; reason: string }> = [];
      let importedCount = 0;
      let lastImportedId: string | null = null;
      for (const file of Array.from(files)) {
        try {
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
          importedCount += 1;
          lastImportedId = saved.id;
        } catch (error) {
          skipped.push({
            name: file.name,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (lastImportedId) {
        await scheduleCatalogSync();
        try {
          await selectPreset(lastImportedId);
        } catch {
          // The preset imported; a failure to activate it should not undo
          // the import result.
        }
      }

      if (skipped.length > 0) {
        const names = skipped.map((entry) => entry.name).join(', ');
        console.warn('[milkdrop] Skipped preset imports:', skipped);
        if (importedCount === 0) {
          throw new Error(
            skipped.length === 1
              ? `Could not import ${names}: ${skipped[0].reason}`
              : `Could not import ${skipped.length} presets (${names}).`,
          );
        }
        setStatus?.(
          `Imported ${importedCount} preset${importedCount === 1 ? '' : 's'}; skipped ${skipped.length} (${names}).`,
        );
      } else if (importedCount > 1) {
        setStatus?.(`Imported ${importedCount} presets.`);
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
