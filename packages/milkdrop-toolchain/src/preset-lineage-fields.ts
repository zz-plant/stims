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

import { serializeString } from './formatter.ts';
import {
  isShaderSection,
  type PresetSyntaxLine,
  parsePresetSyntax,
  printPresetSyntax,
} from './preset-syntax.ts';
import type { MilkdropPresetLineageRef } from './types.ts';

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

/**
 * A source prepared to carry its own lineage as `remix_of_N_*` lines — the
 * same fields an export writes — so a share link's `#code=` payload can
 * carry them the way a `.milk` file does. The receiving import reads the
 * fields back out of the compiled preset (see `lineageFromFields`).
 *
 * Any copy already inside the source is replaced in place, exactly as export
 * drops it before writing fresh, so re-sharing a re-import neither stacks
 * duplicates nor disturbs the surrounding text. With no lineage to write
 * the source comes back unchanged.
 */
export function embedLineageFields(
  source: string,
  derivedFrom: readonly MilkdropPresetLineageRef[] | undefined,
): string {
  if (!derivedFrom || derivedFrom.length === 0) {
    return source;
  }
  const isEmbeddedLineage = (line: PresetSyntaxLine) =>
    line.kind === 'assignment' &&
    line.key != null &&
    isLineageFieldKey(line.key);

  const lines = parsePresetSyntax(source).lines;
  const kept = lines.filter((line) => !isEmbeddedLineage(line));
  const fresh = lineageFieldLines(derivedFrom);

  const firstLineageIndex = lines.findIndex(isEmbeddedLineage);
  let insertAt: number;
  if (firstLineageIndex >= 0) {
    // A copy already sits in the scalar portion: the fresh block replaces
    // it where it is, so re-embedding is byte-stable.
    insertAt = lines
      .slice(0, firstLineageIndex)
      .filter((line) => !isEmbeddedLineage(line)).length;
  } else {
    // No copy to replace: into the scalar portion, before the first shader
    // section — appending at the end would place the lines inside it, where
    // the parser would swallow them as shader text.
    insertAt = kept.findIndex(
      (line) => line.kind === 'section' && isShaderSection(line.section),
    );
    if (insertAt < 0) {
      insertAt = kept.length;
    }
  }

  // Match the file's own line endings where they are known.
  const referenceEol = lines.find((line) => line.eol !== '')?.eol ?? '\n';
  const next = [
    ...kept.slice(0, insertAt),
    ...fresh.map((text) => {
      const equalsAt = text.indexOf('=');
      const line: PresetSyntaxLine = {
        number: 0,
        text,
        eol: referenceEol,
        kind: 'assignment',
        section: null,
        key: text.slice(0, equalsAt),
        rawValue: text.slice(equalsAt + 1),
      };
      return line;
    }),
    ...kept.slice(insertAt),
  ];

  // The line that used to end the file may no longer; without a terminator
  // the inserted text would glue onto it.
  for (let index = 0; index < next.length - 1; index += 1) {
    if (next[index].eol === '') {
      next[index] = { ...next[index], eol: referenceEol };
    }
  }

  return printPresetSyntax({ lines: next });
}
