/**
 * Parser and formatter for the MilkDrop preset credit convention.
 *
 * Preset titles in the wild are a lineage grammar, not just names:
 *
 *   "Stahlregen + Geiss + Shifter - Babylon"
 *   "Krash & Rovastar - Cerebral Demons (Stars Remix)"
 *   "Aderrasi + Flexi - Airhandler (Last Breath - Calm) [moebius edit]"
 *   "Flexi, Rovastar + Geiss - Fractopia vs Bas Relief"
 *
 * Decoder: `+` / `&` / `,` / `and` join the accretive author chain (earliest
 * hand first, latest remixer last); `vs` marks a mashup of two named presets;
 * a trailing `(...)` names the mix/variant; a trailing `[...]` marks a
 * further edit or names grafted source presets.
 *
 * Hazards this parser is built around (measured on the shipped catalog):
 * slug-derived titles use " - " as a word separator ("Eos - Dark - Side -
 * Of - The - Moon"), so the author split takes only the FIRST " - "; mix
 * names may themselves contain " - " ("Last Breath - Calm"), so trailing
 * markers are stripped before the author split.
 */

/**
 * A component credit carried inline in the title — the convention's own way of
 * citing a reusable routine lifted from another author's preset, as in
 * "Eo.S. - glowsticks v2 05 and proton lights (+Krash's beat code)" and
 * "shifter - spills blender + krash beatdetect".
 */
export type PresetComponentCredit = {
  /** The author the component is attributed to, as written. */
  author: string;
  /** What was borrowed, e.g. "beat code", "beat detection". */
  component: string;
};

export type PresetCredit = {
  /**
   * Accretive author chain, earliest hand first. Empty when unparseable.
   * Spellings are as written in the title — see `preset-handles.ts` for the
   * canonical spelling of a handle and for chain-aware matching.
   */
  authors: string[];
  /** Base work title. For mashups, the parts joined with " vs ". */
  title: string;
  /** Trailing "(...)" — the mix/variant name, null for a root work. */
  mixName: string | null;
  /** Trailing "[...]" — an edit marker or grafted-source note. */
  editNote: string | null;
  /** The two-or-more source titles when the base title is an "A vs B" mashup. */
  mashupOf: string[] | null;
  /** Inline component credits lifted out of the title. */
  componentCredits: PresetComponentCredit[];
  /**
   * Compatibility maintenance markers — "(Ati Fix)", "(geiss flicker fix)",
   * "[fixed]". These record the unglamorous work of making a preset run on the
   * other vendor's hardware, and are part of the authorship record.
   */
  compatibilityNotes: string[];
  /** Shader-model variant: "ps2" or "ps3" (MilkDrop 2 era), else null. */
  shaderModel: string | null;
  /** The unmodified input string. */
  raw: string;
};

const DASH_SEPARATORS = [' - ', ' — ', ' – '];
const AUTHOR_SPLIT = /\s*(?:\+|&|,)\s*|\s+and\s+/i;
const MASHUP_SPLIT = /\s+vs\.?\s+/i;

/** Apostrophes in the wild include the prime the catalog actually uses. */
const APOSTROPHE = "['’′`]";
const COMPONENT_NAME = String.raw`beat\s*code|beat\s*detection|beat\s*detect|beatdetect`;

/** "(+Krash's beat code)", "(Krash's beat detection)". */
const PARENTHESIZED_COMPONENT = new RegExp(
  String.raw`\(\s*\+?\s*([\w.]+(?:\s[\w.]+)?)${APOSTROPHE}?s?\s+(${COMPONENT_NAME})\s*\)`,
  'gi',
);

/** The bare form: "spills blender + krash beatdetect". */
const BARE_COMPONENT = new RegExp(
  String.raw`\+\s*([\w.]+)${APOSTROPHE}?s?\s+(${COMPONENT_NAME})\b`,
  'gi',
);

/** "(Ati Fix)", "(geiss flicker fix)", "[fixed]". */
const COMPATIBILITY_MARKER =
  /\(\s*((?:ati|geiss)[\w\s]*fix)\s*\)|\[\s*(fixed)\s*\]/gi;

/** A trailing "(160)" is a serial number in a numbered series, not a mix. */
const SERIAL_PARENTHETICAL = /^[\d\s.-]+$/;

/** "-ps2", "ps3", "(ps2.0)" — the MilkDrop 2 shader-model variants. */
const SHADER_MODEL = /[\s(-]-?\s?ps\s?([23])(?:\.0)?\s*\)?(?=\s|$)/i;

function extractAll(
  text: string,
  pattern: RegExp,
  onMatch: (match: RegExpExecArray) => void,
): string {
  return text.replace(pattern, (...args) => {
    const groups = args.slice(0, -2) as unknown as RegExpExecArray;
    onMatch(groups);
    return ' ';
  });
}

function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([)\]])/g, '$1')
    .trim();
}

function splitAuthors(part: string): string[] {
  return part
    .split(AUTHOR_SPLIT)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function firstDashSplit(
  text: string,
): { before: string; after: string } | null {
  let bestIndex = -1;
  let bestSeparator = '';
  for (const separator of DASH_SEPARATORS) {
    const index = text.indexOf(separator);
    if (index > 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestSeparator = separator;
    }
  }
  if (bestIndex === -1) {
    return null;
  }
  return {
    before: text.slice(0, bestIndex).trim(),
    after: text.slice(bestIndex + bestSeparator.length).trim(),
  };
}

export function parsePresetCredit(
  rawTitle: string,
  authorHint?: string,
): PresetCredit {
  const raw = rawTitle;
  let rest = rawTitle.trim();

  // Component credits, compatibility markers, and shader-model suffixes can
  // sit anywhere in the title, so they are lifted out before the positional
  // author/mix parsing runs. Removing "ps2"/"ps3" also lets the two shader
  // variants of one work share a family key.
  const componentCredits: PresetComponentCredit[] = [];
  const noteComponent = (match: RegExpExecArray) => {
    componentCredits.push({
      author: match[1].trim(),
      component: match[2].trim().toLowerCase().replace(/\s+/g, ' '),
    });
  };
  rest = extractAll(rest, PARENTHESIZED_COMPONENT, noteComponent);
  rest = extractAll(rest, BARE_COMPONENT, noteComponent);

  const compatibilityNotes: string[] = [];
  rest = extractAll(rest, COMPATIBILITY_MARKER, (match) => {
    compatibilityNotes.push((match[1] ?? match[2]).trim());
  });

  let shaderModel: string | null = null;
  const shaderMatch = rest.match(SHADER_MODEL);
  if (shaderMatch) {
    shaderModel = `ps${shaderMatch[1]}`;
    rest = `${rest.slice(0, shaderMatch.index)} ${rest.slice(
      (shaderMatch.index ?? 0) + shaderMatch[0].length,
    )}`;
  }
  rest = tidy(rest);

  let editNote: string | null = null;
  const bracketMatch = rest.match(/\s*\[([^\]]+)\]\s*$/);
  if (bracketMatch) {
    editNote = bracketMatch[1].trim();
    rest = rest.slice(0, bracketMatch.index).trim();
  }

  let mixName: string | null = null;
  const parenMatch = rest.match(/\s*\(([^()]*)\)\s*$/);
  // Only treat a trailing parenthetical as a mix name when a base title
  // remains after stripping it — "(untitled)" alone is a title, not a mix.
  //
  // A purely numeric parenthetical is a serial, not a mix: "Mashup (160)" and
  // "Mashup (169)" are separate works in one author's numbered series, not two
  // remixes of a work called "Mashup", so the number stays in the title and
  // keeps them in separate families.
  if (
    parenMatch &&
    rest.slice(0, parenMatch.index).trim().length > 0 &&
    !SERIAL_PARENTHETICAL.test(parenMatch[1])
  ) {
    mixName = parenMatch[1].trim() || null;
    rest = rest.slice(0, parenMatch.index).trim();
  }

  let authors: string[] = [];
  let title = rest;
  const split = firstDashSplit(rest);
  if (split) {
    authors = splitAuthors(split.before);
    title = split.after;
  } else if (authorHint) {
    // Titles that never carried the convention (user drafts, imports) fall
    // back to the catalog's author field for the chain.
    authors = splitAuthors(authorHint);
  }

  const mashupParts = title
    .split(MASHUP_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const mashupOf = mashupParts.length > 1 ? mashupParts : null;

  return {
    authors,
    title,
    mixName,
    editNote,
    mashupOf,
    componentCredits,
    compatibilityNotes,
    shaderModel,
    raw,
  };
}

/** Canonical credit string: `A + B - Title (Mix) [note]`. */
export function formatPresetCredit(credit: PresetCredit): string {
  const authorPart =
    credit.authors.length > 0 ? `${credit.authors.join(' + ')} - ` : '';
  const mixPart = credit.mixName ? ` (${credit.mixName})` : '';
  const notePart = credit.editNote ? ` [${credit.editNote}]` : '';
  return `${authorPart}${credit.title}${mixPart}${notePart}`;
}

/** The work's own name — mix and edit markers kept, author chain dropped.
 * For surfaces that render a byline next to the title, so the credit is
 * never printed twice. */
export function formatPresetWorkTitle(credit: PresetCredit): string {
  const mixPart = credit.mixName ? ` (${credit.mixName})` : '';
  const notePart = credit.editNote ? ` [${credit.editNote}]` : '';
  return `${credit.title}${mixPart}${notePart}`;
}

/**
 * Split one raw catalog title into what a title/byline surface should show.
 * The byline prefers the chain parsed from the title itself, because it can
 * be longer than the stored author field ("shifter + Aderrasi - Airhandler"
 * with author "shifter" must still credit Aderrasi).
 */
export function splitPresetDisplay(
  rawTitle: string,
  authorField?: string,
): { title: string; byline: string | null } {
  const credit = parsePresetCredit(rawTitle, authorField);
  if (credit.authors.length === 0) {
    return { title: rawTitle.trim(), byline: authorField?.trim() || null };
  }
  return {
    title: formatPresetWorkTitle(credit),
    byline: credit.authors.join(' + '),
  };
}

/**
 * Grouping key for a remix family: every mix, edit, and author combination
 * of the same base work shares one key ("Airhandler (Kali Mix)" and
 * "shifter + Aderrasi - Airhandler (Sadako)" both group under "airhandler").
 */
export function presetFamilyKey(credit: PresetCredit): string {
  return credit.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasAuthor(authors: string[], name: string): boolean {
  const needle = name.trim().toLowerCase();
  return authors.some((author) => author.trim().toLowerCase() === needle);
}

/**
 * Mint the credit for a derivative, following the convention's own rules:
 * the remixer joins the byline (never replaces it), a root work gains a
 * "(... Mix)" slot, and a work that already names a mix keeps it and gains
 * a bracketed edit marker instead — the same shape as
 * "Airhandler (Last Breath - Calm) [moebius morbid vision edit]".
 *
 * `serial` (2+) disambiguates repeated anonymous remixes of the same parent.
 */
export function deriveRemixCredit(
  parent: PresetCredit,
  options: { remixer?: string; mixName?: string; serial?: number } = {},
): PresetCredit {
  const { remixer, mixName, serial } = options;
  const authors =
    remixer && !hasAuthor(parent.authors, remixer)
      ? [...parent.authors, remixer]
      : [...parent.authors];
  const suffix = serial && serial > 1 ? ` ${serial}` : '';

  if (mixName) {
    return { ...parent, authors, mixName, editNote: null };
  }
  if (!parent.mixName) {
    const minted = remixer ? `${remixer} Mix${suffix}` : `Remix${suffix}`;
    return { ...parent, authors, mixName: minted, editNote: null };
  }
  const note = remixer ? `${remixer} edit${suffix}` : `remix${suffix}`;
  return { ...parent, authors, editNote: note };
}

/**
 * Mint the credit for a blend of two presets — the "vs" form, as in
 * "Flexi, Rovastar + Geiss - Fractopia vs Bas Relief".
 */
export function deriveMashupCredit(
  a: PresetCredit,
  b: PresetCredit,
  options: { remixer?: string } = {},
): PresetCredit {
  const authors = [...a.authors];
  for (const name of b.authors) {
    if (!hasAuthor(authors, name)) {
      authors.push(name);
    }
  }
  if (options.remixer && !hasAuthor(authors, options.remixer)) {
    authors.push(options.remixer);
  }
  const title = `${a.title} vs ${b.title}`;
  // A blend inherits both parents' inline component credits and compatibility
  // work — dropping them on the floor would be the same failure as truncating
  // an author chain.
  const componentCredits = [...a.componentCredits];
  for (const credit of b.componentCredits) {
    const duplicate = componentCredits.some(
      (existing) =>
        existing.author.toLowerCase() === credit.author.toLowerCase() &&
        existing.component === credit.component,
    );
    if (!duplicate) componentCredits.push(credit);
  }
  return {
    authors,
    title,
    mixName: null,
    editNote: null,
    mashupOf: [a.title, b.title],
    componentCredits,
    compatibilityNotes: [
      ...new Set([...a.compatibilityNotes, ...b.compatibilityNotes]),
    ],
    shaderModel: a.shaderModel ?? b.shaderModel,
    raw: title,
  };
}
