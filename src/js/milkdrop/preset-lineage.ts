/**
 * Remix families, reconstructed from the credit convention in preset titles.
 *
 * MilkDrop presets were remixed for two decades, and the record of it lives in
 * the titles: "Aderrasi - Airhandler" begat "Airhandler (Kali Mix)", which
 * begat "Painterly Tendrils Colorfast", which begat "(Geiss Echoes Remix)".
 * Every derivative keeps the base work's name and adds a mix marker, and every
 * new hand joins the byline rather than replacing it. That makes the family
 * recoverable from published filenames alone.
 *
 * Measured on the shipped catalog: 159 families with more than one member,
 * covering 424 presets. The largest are *witchcraft* (11) and *Airhandler*
 * (10) — the two branches the scene's own histories use as type specimens.
 *
 * Two caveats this module cannot fix, and callers should not paper over:
 *
 * - Lineage reconstructed from titles is **evidence, not proof**. Titles were
 *   sometimes wrong, and authors sometimes forgot to update them. Sibling
 *   membership is a strong signal; parentage between two siblings is not
 *   asserted here because the titles do not reliably encode it.
 * - Two unrelated works can share a base title. Grouping is by name, so a
 *   family is "presets published under this work's name", nothing stronger.
 */
import {
  formatPresetWorkTitle,
  parsePresetCredit,
  presetFamilyKey,
} from './preset-credit.ts';
import { canonicalHandle, resolveHandleKey } from './preset-handles.ts';

export type LineageCatalogEntry = {
  id: string;
  title: string;
  author?: string;
};

export type PresetLineageMember = {
  id: string;
  /** The work title with its mix/edit markers, byline removed. */
  label: string;
  mixName: string | null;
  editNote: string | null;
  shaderModel: string | null;
  /** Canonical handles credited, in chain order. */
  authors: string[];
  /** Handles this member adds on top of the family's root credit. */
  addedAuthors: string[];
  /** A root work — no mix name and no edit marker. */
  isRoot: boolean;
};

export type PresetLineageFamily = {
  /** Normalized family key, shared by every member. */
  key: string;
  /** The base work's name, as the earliest member spells it. */
  baseTitle: string;
  members: PresetLineageMember[];
};

/**
 * Order a family so it reads as an accretion: root works first, then by how
 * many hands the credit has gathered, then alphabetically for stability.
 */
function compareMembers(a: PresetLineageMember, b: PresetLineageMember) {
  if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
  if (a.authors.length !== b.authors.length) {
    return a.authors.length - b.authors.length;
  }
  return a.label.localeCompare(b.label);
}

/**
 * Group a catalog into remix families keyed by base work.
 *
 * Single-member families are included — callers that only want branched works
 * should filter on `members.length > 1`.
 */
export function buildPresetFamilies(
  entries: readonly LineageCatalogEntry[],
): Map<string, PresetLineageFamily> {
  const families = new Map<string, PresetLineageFamily>();

  for (const entry of entries) {
    const credit = parsePresetCredit(entry.title, entry.author);
    const key = presetFamilyKey(credit);
    if (!key) continue;

    const member: PresetLineageMember = {
      id: entry.id,
      label: formatPresetWorkTitle(credit),
      mixName: credit.mixName,
      editNote: credit.editNote,
      shaderModel: credit.shaderModel,
      authors: credit.authors.map(canonicalHandle),
      addedAuthors: [],
      isRoot: credit.mixName === null && credit.editNote === null,
    };

    const family = families.get(key);
    if (family) {
      family.members.push(member);
    } else {
      families.set(key, { key, baseTitle: credit.title, members: [member] });
    }
  }

  for (const family of families.values()) {
    family.members.sort(compareMembers);
    // The earliest member — the root when one survives, otherwise the shortest
    // chain — is the baseline everyone else accreted onto.
    const baseline = new Set(
      family.members[0].authors.map((handle) => resolveHandleKey(handle)),
    );
    for (const member of family.members.slice(1)) {
      member.addedAuthors = member.authors.filter(
        (handle) => !baseline.has(resolveHandleKey(handle)),
      );
    }
  }

  return families;
}

/**
 * The family a preset belongs to, or null when it has no shipped relatives.
 *
 * A one-member family is not a lineage, so it is reported as null rather than
 * rendering a "family" of one.
 */
export function findPresetFamily(
  entries: readonly LineageCatalogEntry[],
  presetId: string,
): PresetLineageFamily | null {
  const target = entries.find((entry) => entry.id === presetId);
  if (!target) return null;
  const key = presetFamilyKey(parsePresetCredit(target.title, target.author));
  if (!key) return null;
  const family = buildPresetFamilies(entries).get(key);
  if (!family || family.members.length < 2) return null;
  return family;
}
