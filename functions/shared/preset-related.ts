// Related-preset links for the server-rendered body of /?preset=<id> pages.
//
// Every preset page used to be an island: the only way to reach one from
// another was the sitemap. Linking each preset to a few siblings by the same
// author gives the ~1,800 pages an internal link graph. The choice is
// deterministic and rotates with the id (the presets that follow it in the
// author's sorted list) so links are spread across the catalog instead of
// every page pointing at the same few first entries.

import type { PresetMetaTable } from './preset-meta.ts';

const idsByAuthor = new WeakMap<PresetMetaTable, Map<string, string[]>>();

function indexByAuthor(table: PresetMetaTable): Map<string, string[]> {
  let index = idsByAuthor.get(table);
  if (!index) {
    index = new Map();
    for (const id of Object.keys(table).sort()) {
      const author = table[id]?.[1];
      if (!author || author === 'Unknown') continue;
      const list = index.get(author);
      if (list) list.push(id);
      else index.set(author, [id]);
    }
    idsByAuthor.set(table, index);
  }
  return index;
}

/** Up to `limit` other presets by the same author, never including `presetId`. */
export function relatedPresetIds(
  table: PresetMetaTable,
  presetId: string,
  limit = 6,
): string[] {
  const author = table[presetId]?.[1];
  if (!author) return [];
  const ids = indexByAuthor(table).get(author) ?? [];
  const start = ids.indexOf(presetId);
  if (start < 0) return [];
  const related: string[] = [];
  for (let step = 1; step < ids.length && related.length < limit; step += 1) {
    related.push(ids[(start + step) % ids.length] as string);
  }
  return related;
}
