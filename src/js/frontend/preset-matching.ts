// One text matcher for every "type to find a preset" surface. The browse
// filter and the command palette used to rank the same query differently —
// browse did boolean token containment over a composed index, the palette did
// tiered fuzzy scoring over the title. Both now call `scoreFields` here, so a
// query orders results the same way wherever it is typed.
//
// Pure module: no React, no catalog imports. Callers describe their target as
// a list of already-normalized fields, which keeps the caller free to decide
// what is worth matching against (browse adds tags and collection labels; the
// palette only has title and author).

/**
 * Fold text to the matching alphabet: lowercase, every run of non-alphanumeric
 * characters collapsed to a single space. "Eo.S. - Ether" and "eos-ether" both
 * become word sequences a typed query can hit.
 */
export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * One matchable string on a target. `text` must already be normalized (use
 * `toMatchField`); `penalty` demotes weaker fields so a title hit outranks the
 * same hit on an author or tag.
 */
export type MatchField = {
  text: string;
  penalty?: number;
};

/** Standard demotions, so every surface weights secondary fields alike. */
export const FIELD_PENALTY = {
  title: 0,
  author: 50,
  id: 60,
  tag: 80,
  keyword: 50,
  semantic: 120,
} as const;

export function toMatchField(text: string, penalty = 0): MatchField {
  return { text: normalizeMatchText(text), penalty };
}

/**
 * Tiered score of a normalized single-word-or-phrase `query` against one
 * normalized `text`. Null means no match. Higher is better:
 *   exact (1000) > prefix (800) > word-start substring (600) >
 *   substring (400) > subsequence (200)
 * Shorter targets rank slightly higher within a tier.
 */
export function scoreNormalizedText(
  query: string,
  text: string,
  allowSubsequence = true,
): number | null {
  if (query.length === 0) return 0;
  if (query.length > text.length) return null;

  if (text === query) return 1000 - text.length * 0.01;

  const idx = text.indexOf(query);
  if (idx === 0) return 800 - text.length * 0.01;
  if (idx > 0) {
    // Normalization already turned separators into spaces, so a word start is
    // just a preceding space.
    const wordStart = text[idx - 1] === ' ';
    return (wordStart ? 600 : 400) - idx - text.length * 0.01;
  }

  if (!allowSubsequence) return null;

  // Subsequence: every query char appears in order. Penalize total gap so
  // tighter clusters ('brw' -> 'browse') beat scattered hits.
  let ti = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return null;
    if (firstHit === -1) firstHit = found;
    lastHit = found;
    ti = found + 1;
  }
  const spread = lastHit - firstHit + 1;
  return 200 - (spread - query.length) * 2 - firstHit - text.length * 0.01;
}

function bestFieldScore(
  query: string,
  fields: readonly MatchField[],
  allowSubsequence: boolean,
): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (!field.text) continue;
    const raw = scoreNormalizedText(query, field.text, allowSubsequence);
    if (raw === null) continue;
    const score = raw - (field.penalty ?? 0);
    if (best === null || score > best) best = score;
  }
  return best;
}

/**
 * A whole-query match always beats the same words found scattered across
 * fields. Sized to sit between two adjacent tiers (tiers are 200 apart) so a
 * multi-token substring match still outranks a whole-query subsequence match.
 */
const MULTI_TOKEN_PENALTY = 100;

export type ScoreFieldsOptions = {
  /**
   * Whether a query may match as a subsequence of a field. The palette wants
   * this (typing 'brw' should find 'browse'); the browse filter does not —
   * over 2000+ presets subsequence hits match nearly everything and the filter
   * stops filtering.
   */
  allowSubsequence?: boolean;
};

export type CompiledFieldMatcher = {
  normalizedQuery: string;
  tokens: string[];
  score: (fields: readonly MatchField[]) => number | null;
  matches: (fields: readonly MatchField[]) => boolean;
};

/**
 * Pre-compiles query normalization and tokenization for fast batch evaluation
 * across large collections without repeating string transforms per item.
 */
export function createFieldMatcher(
  query: string,
  { allowSubsequence = true }: ScoreFieldsOptions = {},
): CompiledFieldMatcher {
  const normalizedQuery = normalizeMatchText(query);
  if (normalizedQuery.length === 0) {
    return {
      normalizedQuery: '',
      tokens: [],
      score: () => 0,
      matches: () => true,
    };
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);

  const score = (fields: readonly MatchField[]): number | null => {
    const phraseScore = bestFieldScore(
      normalizedQuery,
      fields,
      allowSubsequence,
    );
    if (tokens.length < 2) return phraseScore;

    let total = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const tokenScore = bestFieldScore(tokens[i], fields, allowSubsequence);
      if (tokenScore === null) return phraseScore;
      total += tokenScore;
    }
    const spreadScore = total / tokens.length - MULTI_TOKEN_PENALTY;
    return phraseScore === null
      ? spreadScore
      : Math.max(phraseScore, spreadScore);
  };

  const matches = (fields: readonly MatchField[]): boolean => {
    if (tokens.length <= 1) {
      return bestFieldScore(normalizedQuery, fields, false) !== null;
    }
    for (let i = 0; i < tokens.length; i += 1) {
      if (bestFieldScore(tokens[i], fields, false) === null) {
        return false;
      }
    }
    return true;
  };

  return { normalizedQuery, tokens, score, matches };
}

/**
 * Score `query` against a target's fields. Null means no match; 0 means an
 * empty query (matches everything, contributes no ordering).
 *
 * Multi-word queries are AND-matched: every token must hit some field, and the
 * result is the mean of the per-token scores. "neon tunnel" therefore matches a
 * preset whose title says neon and whose tags say tunnel, ranked below one
 * whose title contains the whole phrase.
 */
export function scoreFields(
  query: string,
  fields: readonly MatchField[],
  options?: ScoreFieldsOptions,
): number | null {
  return createFieldMatcher(query, options).score(fields);
}

/**
 * Boolean form of `scoreFields` for filter surfaces. Subsequence matching is
 * off, so this is exactly "every query token appears in some field".
 */
export function matchesFields(
  query: string,
  fields: readonly MatchField[],
): boolean {
  return createFieldMatcher(query, { allowSubsequence: false }).matches(fields);
}
