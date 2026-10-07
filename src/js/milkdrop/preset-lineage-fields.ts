/**
 * Remix lineage written into the preset file.
 *
 * A remix records its parent (`derivedFrom`) on the saved preset, in this
 * browser only. Exported as a plain `.milk`, the file named no parent, so
 * re-importing it — or sending it to someone — lost the lineage. These keys
 * carry it in the file:
 *
 *     remix_of_1_id=geiss-casino
 *     remix_of_1_title="Geiss - Casino"
 *     remix_of_1_author=Geiss
 *
 * Numbered because a blend has two parents. MilkDrop 2 ignores keys it does
 * not know, and the Stims compiler treats these as metadata, like `title=`,
 * rather than as unknown fields that would cost the preset its fidelity
 * rating.
 */

import { serializeString } from './formatter';
import type { MilkdropPresetLineageRef } from './types';

const LINEAGE_FIELD = /^remix_of_(\d+)_(id|title|author)$/u;

export function isLineageFieldKey(key: string): boolean {
  return LINEAGE_FIELD.test(key.trim().toLowerCase());
}

/** The `remix_of_N_*` lines for a preset's parents, in parent order. */
export function lineageFieldLines(
  derivedFrom: readonly MilkdropPresetLineageRef[] | undefined,
): string[] {
  const lines: string[] = [];
  (derivedFrom ?? []).forEach((parent, index) => {
    const n = index + 1;
    lines.push(`remix_of_${n}_id=${serializeString(parent.id)}`);
    lines.push(`remix_of_${n}_title=${serializeString(parent.title)}`);
    if (parent.author) {
      lines.push(`remix_of_${n}_author=${serializeString(parent.author)}`);
    }
  });
  return lines;
}

function unquote(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Parents read back from a file's `remix_of_N_*` keys, or undefined. */
export function lineageFromFields(
  fields: ReadonlyArray<{ key: string; rawValue: string }> | undefined,
): MilkdropPresetLineageRef[] | undefined {
  const byIndex = new Map<number, Partial<MilkdropPresetLineageRef>>();
  for (const { key, rawValue } of fields ?? []) {
    const match = LINEAGE_FIELD.exec(key.trim().toLowerCase());
    if (!match) continue;
    const index = Number(match[1]);
    const part = match[2] as 'id' | 'title' | 'author';
    const entry = byIndex.get(index) ?? {};
    entry[part] = unquote(rawValue);
    byIndex.set(index, entry);
  }
  const parents = [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry)
    .filter((entry): entry is MilkdropPresetLineageRef =>
      Boolean(entry.id && entry.title),
    )
    .map(({ id, title, author }) =>
      author ? { id, title, author } : { id, title },
    );
  return parents.length > 0 ? parents : undefined;
}
