/**
 * Search over the MilkDrop builtin table for the editor's Reference tab.
 *
 * Authors coming from MilkDrop 2 know the function names but not always the
 * spelling ("what was the clamp one?") or which variables are inputs versus
 * things they may write. This ranks the same table that drives highlighting,
 * autocomplete and the compiler, so the reference can never list a function
 * the compiler does not accept.
 */
import {
  MILKDROP_BUILTIN_DOCS,
  type MilkdropBuiltinDoc,
} from './builtin-docs.ts';

export type ReferenceEntry = MilkdropBuiltinDoc & {
  /** Text inserted at the cursor: `clamp(x, min, max)` or a bare name. */
  insertText: string;
  /** Human label for the kind/group badge. */
  category: string;
};

const GROUP_LABELS = {
  signal: 'input',
  state: 'you set',
  register: 'register',
} as const;

function categoryOf(entry: MilkdropBuiltinDoc): string {
  if (entry.kind === 'function') return 'function';
  if (entry.kind === 'constant') return 'constant';
  return entry.group ? GROUP_LABELS[entry.group] : 'variable';
}

function insertTextOf(entry: MilkdropBuiltinDoc): string {
  if (entry.kind !== 'function') return entry.name;
  // Zero-parameter functions (rand-style) still need their parentheses.
  return `${entry.name}(${(entry.params ?? []).join(', ')})`;
}

/** q1..q32 and t1..t32 would otherwise bury every other result. */
const REGISTER_NAME = /^[qt]\d+$/u;

function toEntry(entry: MilkdropBuiltinDoc): ReferenceEntry {
  return {
    ...entry,
    insertText: insertTextOf(entry),
    category: categoryOf(entry),
  };
}

function score(entry: MilkdropBuiltinDoc, needle: string): number {
  const name = entry.name.toLowerCase();
  if (name === needle) return 100;
  if (name.startsWith(needle))
    return 80 - Math.min(name.length - needle.length, 20);
  if (name.includes(needle)) return 60;
  if (entry.doc.toLowerCase().includes(needle)) return 40;
  return 0;
}

/**
 * Best matches first. An empty query lists everything except the 64
 * registers, which are summarised by a single q/t entry when queried.
 */
export function searchReference(
  query: string,
  docs: readonly MilkdropBuiltinDoc[] = MILKDROP_BUILTIN_DOCS,
  limit = 60,
): ReferenceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return docs
      .filter((entry) => !REGISTER_NAME.test(entry.name))
      .slice(0, limit)
      .map(toEntry);
  }
  const wantsRegister = /^[qt]\d*$/u.test(needle);
  return docs
    .filter((entry) => wantsRegister || !REGISTER_NAME.test(entry.name))
    .map((entry) => ({ entry, rank: score(entry, needle) }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ entry }) => toEntry(entry));
}
