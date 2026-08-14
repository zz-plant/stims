/**
 * Handle registry for MilkDrop preset authors.
 *
 * Preset authors published under handles, and the filename record spells those
 * handles inconsistently: sort-order hacks (`_Geiss`), casing drift
 * (`Flexi`/`flexi`/`_Flexi`), punctuation drift (`Eo.S.`/`Eo.S`/`Eo.s`), and
 * outright variants (`fiShbRaiN`/`fishbrain`/`fiSHbRAiN`). Measured on the
 * shipped 1,787-preset catalog: 393 distinct author strings collapse to 136
 * once those are normalized.
 *
 * Two rules govern this file:
 *
 * 1. **Credit by handle, spelled as published.** The canonical spelling below
 *    is the one the author used, not a tidied-up version — `fiShbRaiN`, not
 *    `Fishbrain`; `Eo.S.`, not `EoS`. Where the record is genuinely split the
 *    dominant filename spelling wins, and the variant is noted in the alias
 *    list rather than silently dropped.
 * 2. **Credit chains are accretive.** A MilkDrop byline names every hand that
 *    touched the work, earliest first; a remixer joins the chain rather than
 *    replacing it. So "credits X" means "X appears anywhere in the chain", not
 *    "the author field equals X". Matching on the whole string instead
 *    undercounts badly: 102 catalog presets credit Phat, and only 5 name him
 *    alone.
 */

/**
 * Chain separators. `+`, `&`, `,` and `and` are the documented joins; ` n `
 * ("Flexi n Aderrasi") and ` vs ` ("Unchained vs Rovastar") also appear in the
 * catalog, and `et al` trails a truncated chain.
 */
const CHAIN_SPLIT =
  /\s*(?:\+|&|,|=)\s*|\s+_\s+|\s+(?:and|n|vs\.?|et\.?\s*al\.?)\s+/i;

/** Leading sort-order hacks for the preset browser — never part of the name. */
const SORT_ORDER_PREFIX = /^[_!*$\-\s]+/;

/**
 * Chain filler that survives the split: a bare `al` left over from "et al",
 * and the `ft`/`feat` used in "Eo.S. Mandala Chaser Ft AdamFX".
 */
const LEADING_FILLER = /^(?:et\.?\s*al\.?|al|ft\.?|feat\.?)\s+/i;

/**
 * A trailing `[...]` on an author fragment is a technique credit, not part of
 * the handle: "martin [shadow harlequins shape code]" is Martin, applying a
 * technique attributed to ShadowHarlequin.
 */
const TRAILING_TECHNIQUE = /\s*\[[^\]]*\]\s*$/;

/**
 * Underscores and bare spaces are ambiguous: they join handles in "Phat_Eo.S."
 * and "aderassi geiss", but they also live *inside* the handles
 * `27_super_goats`, `Fumbling_Foo`, `_Mig_304`, `amandio c`, and `Redi Jedi`.
 *
 * Splitting is only safe when the fragment is not itself a known handle and
 * every resulting part is one the registry knows from elsewhere in the
 * catalog. Anything else stays whole — an unrecognized phrase like "A New Wave
 * Trend in Milk" must not be shredded into invented authors.
 */
function splitKnownChain(
  fragment: string,
  separator: string | RegExp,
): string[] | null {
  if (isKnownHandle(fragment)) return null;
  const parts = fragment
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts.every((part) => isKnownHandle(part)) ? parts : null;
}

/**
 * The "tribute" form: "AdamFX 2 Geiss", "A Milk Art Detail 2 flexi" — the `2`
 * reads as "to". Only the right-hand side is reliably a handle; the left is
 * often a phrase, so splitting on it blindly invents authors like
 * "a milk art detail". We credit the right side only when it is already a
 * known handle, and keep the raw string otherwise.
 */
const TRIBUTE_FORM = /^(.*?)\s+2\s+(\S.*)$/;

/**
 * Reduce a raw author fragment to a lookup key: casing, sort-order prefixes,
 * stray brackets, and trailing dots are all noise.
 */
export function normalizeHandleKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(SORT_ORDER_PREFIX, '')
    .replace(/[[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim();
}

/**
 * Canonical display spelling, keyed by normalized handle.
 *
 * Curated rather than derived, so the byline a reader sees does not drift when
 * the catalog gains or loses presets. Entries are ordered by how many catalog
 * presets credit the handle.
 */
const CANONICAL_HANDLES: Record<string, string> = {
  geiss: 'Geiss',
  flexi: 'Flexi',
  martin: 'Martin',
  rovastar: 'Rovastar',
  'eo.s': 'Eo.S.',
  stahlregen: 'Stahlregen',
  unchained: 'Unchained',
  fishbrain: 'fiShbRaiN',
  phat: 'Phat',
  aderrasi: 'Aderrasi',
  shifter: 'shifter',
  zylot: 'Zylot',
  orb: 'ORB',
  suksma: 'suksma',
  cope: 'cope',
  goody: 'Goody',
  krash: 'Krash',
  luxxx: 'LuxXx',
  'amandio c': 'amandio c',
  yin: 'Yin',
  hexcollie: 'Hexcollie',
  bdrv: 'BDRV',
  loadus: 'Loadus',
  adamfx: 'AdamFX',
  idiot: 'Idiot',
  'redi jedi': 'Redi Jedi',
  che: 'Che',
  rocke: 'Rocke',
  shadowharlequin: 'ShadowHarlequin',
  pieturp: 'PieturP',
  mstress: 'Mstress',
  'studio music': 'Studio Music',
  telek: 'Telek',
  bmelgren: 'Bmelgren',
  evet: 'Evet',
  illusion: 'Illusion',
  rozzor: 'Rozzor',
  mash0000: 'mash0000',
  benski: 'Benski',
  // The `_Mig_NNN` files are one author's numbered output, not an untitled
  // series: Mig appears as a named co-author in an ordinary credit chain
  // ("xmuzack + martin + Mig + Eo.S. - look inside the stained glass flame").
  // The leading underscores are the usual sort-order hack.
  mig: 'Mig',
};

/**
 * Variant spellings that survive `normalizeHandleKey` — genuinely different
 * strings for the same person, not just casing.
 */
const HANDLE_ALIASES: Record<string, string> = {
  'ryan geiss': 'geiss',
  eos: 'eo.s',
  'eo s': 'eo.s',
  aderassi: 'aderrasi', // misspelling in the "Hexcollie, Aderassi, BDRV" chain
  'shadow harlequin': 'shadowharlequin',
  studiomusic: 'studio music',
  'adam fx': 'adamfx',
  'adam fx 2': 'adamfx',
  fishbrian: 'fishbrain',
};

/** Resolve a raw fragment to its registry key, following aliases. */
export function resolveHandleKey(raw: string): string {
  const key = normalizeHandleKey(raw);
  return HANDLE_ALIASES[key] ?? key;
}

/** True when the handle is one the registry knows how to spell. */
export function isKnownHandle(raw: string): boolean {
  return resolveHandleKey(raw) in CANONICAL_HANDLES;
}

/**
 * Canonical display spelling for a handle. Unregistered handles — the long
 * tail of one- and two-preset authors — are returned trimmed and otherwise
 * untouched, because inventing a capitalization for someone is exactly the
 * error this registry exists to prevent.
 */
export function canonicalHandle(raw: string): string {
  const key = resolveHandleKey(raw);
  if (CANONICAL_HANDLES[key]) return CANONICAL_HANDLES[key];
  return raw
    .trim()
    .replace(SORT_ORDER_PREFIX, '')
    .replace(/^\[(.*)\]$/, '$1') // "[Ishan]" is a handle in brackets
    .trim();
}

/** Registry keys longest-first, so "eo.s" wins over a shorter prefix. */
const MATCHABLE_KEYS = [
  ...Object.keys(CANONICAL_HANDLES),
  ...Object.keys(HANDLE_ALIASES),
].sort((a, b) => b.length - a.length);

/** Characters that can sit between two handles in an unseparated title. */
const HANDLE_BOUNDARY = /[\s+&,._\-|]/;

/** Words that join two handles without being part of either. */
const INTERSTITIAL_FILLER = /^(?:et\.?\s*al\.?|al|ft\.?|feat\.?|and|n|2)\s+/i;

/**
 * Read an author chain off the front of a title that never carried the
 * " - " convention: "Eo.S.+Phat -Eater_v2", "Flexi + Phat fractal Star_Child".
 *
 * Deliberately conservative — it only consumes handles the registry already
 * knows from elsewhere in the catalog, and gives up entirely rather than
 * guessing. An unrecognized leading token like "BrainStain-Blackwidow" returns
 * null and stays unattributed, which is the correct outcome until someone
 * confirms the handle and adds it to the registry.
 *
 * Returns null when no handle matches, or when the handles consume the whole
 * string and leave no work title behind.
 */
export function parseLeadingHandles(
  text: string,
): { handles: string[]; rest: string } | null {
  const source = text.trim().replace(SORT_ORDER_PREFIX, '');
  const lower = source.toLowerCase();
  const handles: string[] = [];
  const seen = new Set<string>();
  // Only advances when a handle is actually consumed, so a failed probe never
  // eats text off the front of the work title.
  let committed = 0;

  for (;;) {
    let probe = committed;
    while (probe < source.length && HANDLE_BOUNDARY.test(source[probe])) {
      probe += 1;
    }
    // Filler between two handles: the "2" of "AdamFx 2 Geiss" (a tribute "to"),
    // the "al" left over from "et al", and the "ft" of "Chaser Ft AdamFX".
    if (handles.length > 0) {
      const filler = INTERSTITIAL_FILLER.exec(source.slice(probe));
      if (filler) probe += filler[0].length;
    }
    const key = MATCHABLE_KEYS.find((candidate) => {
      if (!lower.startsWith(candidate, probe)) return false;
      const next = source[probe + candidate.length];
      // Require a boundary after the match so "orb" does not eat "orbus".
      return next === undefined || HANDLE_BOUNDARY.test(next);
    });
    if (!key) break;
    pushHandle(handles, seen, key);
    committed = probe + key.length;
  }

  if (handles.length === 0) return null;
  const rest = source
    .slice(committed)
    .replace(/^[\s+&,._\-|]+/, '')
    .trim();
  return rest ? { handles, rest } : null;
}

function pushHandle(into: string[], seen: Set<string>, raw: string) {
  const key = resolveHandleKey(raw);
  if (!key || key === 'unknown' || seen.has(key)) return;
  seen.add(key);
  into.push(canonicalHandle(raw));
}

/**
 * Every handle credited by an author field, in chain order (earliest hand
 * first). Returns canonical spellings, deduplicated.
 *
 * "Stahlregen & Geiss + Rovastar + Illusion + Krash + Rozzor" yields all six.
 */
export function creditedHandles(authorField?: string): string[] {
  const field = authorField?.trim();
  if (!field) return [];

  const handles: string[] = [];
  const seen = new Set<string>();

  for (const segment of field.split(CHAIN_SPLIT)) {
    // Strip a trailing technique credit only when a handle remains in front of
    // it — "[Ishan]" is a bracketed handle, not a bare technique note.
    const stripped = segment?.trim().replace(TRAILING_TECHNIQUE, '').trim();
    const fragment = (stripped || segment?.trim() || '')
      .replace(LEADING_FILLER, '')
      .trim();
    if (!fragment) continue;

    const joined =
      splitKnownChain(fragment, '_') ?? splitKnownChain(fragment, /\s+/);
    if (joined) {
      for (const part of joined) pushHandle(handles, seen, part);
      continue;
    }

    const tribute = fragment.match(TRIBUTE_FORM);
    if (tribute) {
      // "AdamFX 2 Geiss" credits both hands; "A Milk Art Detail 2 flexi"
      // credits only the side we can confirm, and the unconfirmable phrase is
      // dropped rather than promoted to a handle.
      const [, dedicator, dedicatee] = tribute;
      const knownDedicator = isKnownHandle(dedicator);
      const knownDedicatee = isKnownHandle(dedicatee);
      if (knownDedicator || knownDedicatee) {
        if (knownDedicator) pushHandle(handles, seen, dedicator);
        if (knownDedicatee) pushHandle(handles, seen, dedicatee);
        continue;
      }
    }

    pushHandle(handles, seen, fragment);
  }

  return handles;
}

/** True when `handle` appears anywhere in the entry's credit chain. */
export function creditsHandle(authorField: string | undefined, handle: string) {
  const target = resolveHandleKey(handle);
  if (!target) return false;
  return creditedHandles(authorField).some(
    (credited) => resolveHandleKey(credited) === target,
  );
}
