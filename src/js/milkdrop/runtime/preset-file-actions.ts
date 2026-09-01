import { compileMilkdropPresetSource } from '../compiler';
import {
  deriveRemixCredit,
  formatPresetCredit,
  parsePresetCredit,
} from '../preset-credit';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
} from '../types';
import { downloadPresetFile } from './persistence';
import { isEditablePreset } from './session';

const MAX_PRESET_FILE_BYTES = 2 * 1024 * 1024;

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
          if (file.size > MAX_PRESET_FILE_BYTES) {
            throw new Error(
              'the file is larger than the 2 MB limit. Choose a smaller plain-text .milk file.',
            );
          }
          const raw = await file.text();
          if (raw.trim().length === 0) {
            throw new Error(
              'the file is empty. Choose a .milk file that contains preset text.',
            );
          }
          if (raw.includes('\0')) {
            throw new Error(
              'binary data was detected. Choose a plain-text .milk file.',
            );
          }
          const compiled = compileMilkdropPresetSource(raw, {
            title: file.name.replace(/\.[^.]+$/u, ''),
            origin: 'imported',
          });
          // Most .milk files omit author= but carry the credit convention
          // in their filename ("Rovastar - Bytes 03.milk"), so the byline
          // falls back to the chain parsed from the title.
          const credit = parsePresetCredit(compiled.title);
          const saved = await catalogStore.savePreset({
            id: `${compiled.source.id}-${Date.now()}`,
            title: compiled.title,
            raw,
            origin: 'imported',
            author:
              compiled.author ??
              (credit.authors.length > 0
                ? credit.authors.join(' + ')
                : undefined),
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
        const details = skipped
          .map((entry) => `"${entry.name}": ${entry.reason}`)
          .join(' ');
        console.warn('[milkdrop] Skipped preset imports:', skipped);
        if (importedCount === 0) {
          throw new Error(
            skipped.length === 1
              ? `Failed to import ${details}`
              : `Failed to import ${skipped.length} presets. ${details}`,
          );
        }
        setStatus?.(
          `Imported ${importedCount} preset${importedCount === 1 ? '' : 's'}; skipped ${skipped.length}. ${details}`,
        );
      } else if (importedCount > 1) {
        setStatus?.(`Imported ${importedCount} presets.`);
      }
    },

    async duplicatePreset() {
      // A duplicate is a remix in the MilkDrop credit tradition: the parent
      // keeps its byline, the derivative gains a mix/edit marker, and the
      // parent ref is recorded so lineage survives renames.
      const compiled = getActiveCompiled();
      const parent = parsePresetCredit(compiled.title, compiled.author);
      const takenTitles = new Set(
        (await catalogStore.listPresets()).map((entry) => entry.title),
      );
      let credit = deriveRemixCredit(parent);
      for (
        let serial = 2;
        takenTitles.has(formatPresetCredit(credit)) && serial < 100;
        serial += 1
      ) {
        credit = deriveRemixCredit(parent, { serial });
      }
      const saved = await catalogStore.savePreset({
        id: `${compiled.source.id}-remix-${Date.now()}`,
        title: formatPresetCredit(credit),
        raw: compiled.formattedSource,
        origin: 'user',
        author:
          credit.authors.length > 0
            ? credit.authors.join(' + ')
            : compiled.author,
        derivedFrom: [
          {
            id: compiled.source.id,
            title: compiled.title,
            author: compiled.author,
          },
        ],
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
