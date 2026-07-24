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
  } catch {}
}

export function usePersistentPresetQueue(catalog: PresetCatalogEntry[]) {
  const [presetIds, setPresetIds] = useState<string[]>(readStoredQueue);

  useEffect(() => writeStoredQueue(presetIds), [presetIds]);

  const entries = useMemo(() => {
    const byId = new Map(catalog.map((entry) => [entry.id, entry]));
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

  const popNext = useCallback(() => {
    let nextId: string | null = null;
    setPresetIds((current) => {
      nextId = current[0] ?? null;
      return current.slice(1);
    });
    return nextId;
  }, []);

  return { presetIds, entries, add, remove, clear, move, popNext };
}
