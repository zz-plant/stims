// Related-preset links for /?preset=<id> pages, rendered by the edge's
// <noscript> copy and by the workspace below the stage.
//
// Every preset page used to be an island: the only way to reach one from
// another was the sitemap. Linking each preset to a few others by the same
// author gives the ~1,800 pages an internal link graph. The choice is
// deterministic and rotates with the id (the presets that follow it in the
// author's sorted list) so links are spread across the catalog instead of
// every page pointing at the same few first entries.
//
// "By the same author" means the credit chain names that handle anywhere, the
// rule the /author/<slug> pages and Browse's author filter already use
// (creditsHandle in preset-handles.ts). A chain such as "Stahlregen + Geiss"
// gets one group per credited handle rather than a list of the few presets
// that carry exactly the same chain.

import {
  creditedHandles,
  resolveHandleKey,
} from '../../src/js/milkdrop/preset-handles.ts';
import type { PresetMetaTable } from './preset-meta.ts';

/** Handles past this many in a long chain get no group of their own. */
export const MAX_RELATED_GROUPS = 3;

export type RelatedPresetGroup = {
  /** The credited handle, spelled as published (canonicalHandle). */
  handle: string;
  ids: string[];
};

// Keyed by the table object, so a table that is no longer used takes its
// index with it; each index holds one sorted id list per credited handle.
const idsByHandle = new WeakMap<PresetMetaTable, Map<string, string[]>>();

function indexByHandle(table: PresetMetaTable): Map<string, string[]> {
  let index = idsByHandle.get(table);
  if (!index) {
    index = new Map();
    for (const id of Object.keys(table).sort()) {
      for (const handle of creditedHandles(table[id]?.[1])) {
        const key = resolveHandleKey(handle);
        const list = index.get(key);
        if (list) list.push(id);
        else index.set(key, [id]);
      }
    }
    idsByHandle.set(table, index);
  }
  return index;
}

/**
 * Every preset whose credit chain names `handle`, sorted by id: the presets an
 * /author/<slug> page lists.
 */
export function presetIdsCreditingHandle(
  table: PresetMetaTable,
  handle: string,
): string[] {
  return [...(indexByHandle(table).get(resolveHandleKey(handle)) ?? [])];
}

/**
 * Up to `limit` other presets crediting the same hands as `presetId`, grouped
 * by handle in credit-chain order. One handle gets the whole limit; a chain
 * splits it across its first MAX_RELATED_GROUPS handles, and a preset already
 * listed under an earlier handle is not repeated. Never includes `presetId`.
 */
export function relatedPresetGroups(
  table: PresetMetaTable,
  presetId: string,
  limit = 6,
): RelatedPresetGroup[] {
  const handles = creditedHandles(table[presetId]?.[1]).slice(
    0,
    MAX_RELATED_GROUPS,
  );
  if (handles.length === 0) return [];
  const index = indexByHandle(table);
  const perGroup = Math.max(1, Math.floor(limit / handles.length));
  const listed = new Set([presetId]);
  const groups: RelatedPresetGroup[] = [];
  for (const handle of handles) {
    const ids = index.get(resolveHandleKey(handle)) ?? [];
    const start = ids.indexOf(presetId);
    const picked: string[] = [];
    for (
      let step = 1;
      step < ids.length && picked.length < perGroup;
      step += 1
    ) {
      const id = ids[(start + step) % ids.length] as string;
      if (listed.has(id)) continue;
      listed.add(id);
      picked.push(id);
    }
    if (picked.length > 0) groups.push({ handle, ids: picked });
  }
  return groups;
}
