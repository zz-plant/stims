/**
 * Draft persistence — a preset's draft is kept only while it differs from the
 * preset's original source.
 *
 * A draft overrides the original on every later load. The runtime used to
 * save one whenever a preset was opened, edited or not, so every preset a
 * visitor had ever looked at was pinned to the copy they first saw: a fix to
 * a bundled `.milk` file never reached them, and reverting an edit by hand
 * still left a draft that read as one.
 *
 * "Original" means the original *as the editor shows it*. A load replaces the
 * buffer with the compiler's formatted text, so every edit starts from that,
 * and comparing against the raw file would call an untouched preset edited.
 */

import { samePresetSource } from './overlay/source-diff.ts';
import type { MilkdropCatalogStore, MilkdropPresetSource } from './types';

/**
 * The preset's original source in the form the editor shows on load.
 * `format` is a compile, so the last result is kept: edits arrive every
 * keystroke pause and all ask about the same preset.
 */
export function createOriginalSourceResolver(
  store: Pick<MilkdropCatalogStore, 'getPresetSource'>,
  format: (source: MilkdropPresetSource) => string,
) {
  let lastRaw: string | null = null;
  let lastFormatted = '';
  return async (id: string): Promise<string | null> => {
    const source = await store.getPresetSource(id);
    if (!source) return null;
    if (source.raw !== lastRaw) {
      lastFormatted = format(source);
      lastRaw = source.raw;
    }
    return lastFormatted;
  };
}

/**
 * Save `source` as the preset's draft, or clear the draft when `source` is
 * the original again. Writes run in order: a save that resolved after a
 * later clear would bring back a draft the visitor had just reverted.
 */
export function createDraftPersistence(
  store: Pick<MilkdropCatalogStore, 'saveDraft' | 'clearDraft'>,
  resolveOriginal: (id: string) => Promise<string | null>,
) {
  let queue: Promise<void> = Promise.resolve();
  return (id: string, source: string): Promise<void> => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        const original = await resolveOriginal(id);
        if (original !== null && samePresetSource(original, source)) {
          await store.clearDraft(id);
          return;
        }
        await store.saveDraft(id, source);
      });
    return queue;
  };
}

/**
 * Clear a stored draft that is only the original. Loads used to save these
 * for every preset opened; they change nothing until the original is
 * updated, and then they hide the update.
 */
export async function dropRedundantDraft(
  store: Pick<MilkdropCatalogStore, 'getDraft' | 'clearDraft'>,
  resolveOriginal: (id: string) => Promise<string | null>,
  id: string,
): Promise<boolean> {
  const draft = await store.getDraft(id);
  if (draft === null) return false;
  const original = await resolveOriginal(id);
  if (original === null || !samePresetSource(original, draft)) return false;
  await store.clearDraft(id);
  return true;
}

/**
 * Whether the editor's newest compiled source has reached storage. A save
 * is queued per edit and can fail (IndexedDB blocked, over quota, private
 * mode); until one succeeds the edit exists only in this tab, so the shell
 * keeps its leave-page warning while `onUnsavedChange(true)` holds.
 *
 * Only the newest save decides the state: an older one resolving late must
 * not mark a newer, still-pending edit as saved. A failure is reported once
 * per run of failures, not once per keystroke pause.
 */
export function createDraftSaveStatus({
  persist,
  onUnsavedChange,
  onFailure,
}: {
  persist: (id: string, source: string) => Promise<void>;
  onUnsavedChange: (unsaved: boolean) => void;
  onFailure: (error: unknown) => void;
}) {
  let revision = 0;
  let unsaved = false;
  let failureReported = false;
  const setUnsaved = (next: boolean) => {
    if (next === unsaved) return;
    unsaved = next;
    onUnsavedChange(next);
  };
  return {
    save(id: string, source: string): Promise<void> {
      const saveRevision = ++revision;
      setUnsaved(true);
      return persist(id, source).then(
        () => {
          if (saveRevision !== revision) return;
          failureReported = false;
          setUnsaved(false);
        },
        (error: unknown) => {
          if (failureReported) return;
          failureReported = true;
          onFailure(error);
        },
      );
    },
    /** A preset load replaced the buffer: nothing edited is pending. */
    reset() {
      revision += 1;
      failureReported = false;
      setUnsaved(false);
    },
  };
}
