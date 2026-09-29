import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PresetCatalogEntry } from './contracts.ts';

const STORAGE_KEY = 'stims:preset-queue:v1';
const MAX_QUEUE_SIZE = 50;

type QueueSnapshot = { presetIds: string[] };

function readStoredQueue(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<QueueSnapshot>;
    return Array.isArray(parsed.presetIds)
      ? parsed.presetIds.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeStoredQueue(presetIds: string[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        presetIds: presetIds.slice(0, MAX_QUEUE_SIZE),
      } satisfies QueueSnapshot),
    );
  } catch (error) {
    console.debug('Failed to write stored preset queue', error);
  }
}

export function usePersistentPresetQueue(catalog: PresetCatalogEntry[]) {
  const [presetIds, setPresetIds] = useState<string[]>(readStoredQueue);

  useEffect(() => writeStoredQueue(presetIds), [presetIds]);

  const entries = useMemo(() => {
    const byId = new Map<string, PresetCatalogEntry>();
    for (const entry of catalog) {
      byId.set(entry.id, entry);
    }
    return presetIds
      .map((id) => byId.get(id))
      .filter((entry): entry is PresetCatalogEntry => Boolean(entry));
  }, [catalog, presetIds]);

  const add = useCallback((presetId: string) => {
    setPresetIds((current) =>
      current.includes(presetId)
        ? current
        : [...current, presetId].slice(-MAX_QUEUE_SIZE),
    );
  }, []);

  const remove = useCallback((presetId: string) => {
    setPresetIds((current) => current.filter((id) => id !== presetId));
  }, []);

  const clear = useCallback(() => setPresetIds([]), []);

  const move = useCallback((presetId: string, direction: -1 | 1) => {
    setPresetIds((current) => {
      const index = current.indexOf(presetId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  /**
   * Reads the head from the rendered state, not from inside the updater.
   *
   * This used to assign its return value inside `setPresetIds` and return it
   * afterwards. React only runs an updater during dispatch on the eager-state
   * path, which needs the owning fiber to have no pending lanes — and this
   * queue lives in the workspace provider, which re-renders every frame while
   * audio plays. So in the one situation the cue deck is even mounted, the
   * updater was deferred, `popNext()` returned null while still queueing the
   * removal, and "Take" dropped the cued preset and reported "Nothing is
   * cued". `queue-skip` already read `presetIds[0]` directly; this now does
   * the same.
   *
   * The updater re-checks the head so a queue that changed in between loses
   * nothing: it removes the entry this call actually returned, or removes
   * nothing at all.
   */
  const popNext = useCallback(() => {
    const nextId = presetIds[0] ?? null;
    if (nextId === null) return null;
    setPresetIds((current) =>
      current[0] === nextId ? current.slice(1) : current,
    );
    return nextId;
  }, [presetIds]);

  return { presetIds, entries, add, remove, clear, move, popNext };
}
