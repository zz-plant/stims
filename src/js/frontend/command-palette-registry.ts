// Command palette result sources + matching. Pure module (no React): App
// supplies actions and preset sources, CommandPalette.tsx calls
// buildPaletteResults per keystroke. Kept separate from the component so the
// ranking logic is unit-testable and App can type its action list against
// CommandAction without importing the component.

/** A runnable command shown in the palette. Supplied by App as props. */
export type CommandAction = {
  /** Stable unique id, e.g. 'open-browse' or 'transition-1s'. */
  id: string;
  /** Visible label, e.g. 'Open browse panel'. */
  label: string;
  /** Extra match terms not shown in the label, e.g. ['presets', 'library']. */
  keywords?: string[];
  /** Display-only hint, e.g. 'B' or 'Cmd+Enter'. Rendered as <kbd>. */
  shortcutHint?: string;
  run: () => void;
};

/** Minimal preset shape the palette needs — a projection of catalog entries. */
export type PalettePresetResult = {
  id: string;
  title: string;
  author?: string;
};

export type PaletteResult =
  | { kind: 'action'; id: string; action: CommandAction; score: number }
  | { kind: 'preset'; id: string; preset: PalettePresetResult; score: number };

/**
 * Case-insensitive fuzzy-ish score for `query` against `text`.
 * Returns null on no match. Higher is better:
 *   - exact match > prefix > word-start substring > substring > subsequence
 *   - shorter targets rank slightly higher (tighter match)
 */
export function scoreMatch(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > t.length) return null;

  if (t === q) return 1000 - t.length * 0.01;

  const idx = t.indexOf(q);
  if (idx === 0) return 800 - t.length * 0.01;
  if (idx > 0) {
    const wordStart = t[idx - 1] === ' ' || t[idx - 1] === '-';
    return (wordStart ? 600 : 400) - idx - t.length * 0.01;
  }

  // Subsequence: every query char appears in order. Penalize total gap so
  // tighter clusters ('brw' -> 'browse') beat scattered hits.
  let ti = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (firstHit === -1) firstHit = found;
    lastHit = found;
    ti = found + 1;
  }
  const spread = lastHit - firstHit + 1;
  return 200 - (spread - q.length) * 2 - firstHit - t.length * 0.01;
}

function scoreAction(query: string, action: CommandAction): number | null {
  let best = scoreMatch(query, action.label);
  for (const keyword of action.keywords ?? []) {
    const s = scoreMatch(query, keyword);
    // Keyword hits rank a notch under equivalent label hits.
    if (s !== null && (best === null || s - 50 > best)) best = s - 50;
  }
  return best;
}

function scorePreset(
  query: string,
  preset: PalettePresetResult,
): number | null {
  const titleScore = scoreMatch(query, preset.title);
  const authorScore = preset.author ? scoreMatch(query, preset.author) : null;
  if (titleScore === null && authorScore === null) return null;
  return Math.max(
    titleScore ?? Number.NEGATIVE_INFINITY,
    (authorScore ?? Number.NEGATIVE_INFINITY) - 50,
  );
}

export type BuildPaletteResultsInput = {
  query: string;
  actions: CommandAction[];
  /** Static catalog projection. Ignored when searchPresets is provided. */
  presets?: PalettePresetResult[];
  /** Callback source (e.g. an indexed search). Takes precedence over presets. */
  searchPresets?: (query: string) => PalettePresetResult[];
  /** Cap on returned results. Default 12. */
  limit?: number;
  /**
   * Frecency: use counts keyed by result id ('action:<id>' / 'preset:<id>').
   * Applied as a bounded boost so repeat workflows surface with one or two
   * typed characters — it breaks ties and reorders near-equal matches, but
   * can never outrank a decisively better text match (boost caps below the
   * ~200-point gap between match tiers).
   */
  useCounts?: Record<string, number>;
};

/** Bounded so frecency reorders within a match tier, never across tiers. */
function frecencyBoost(count: number | undefined): number {
  if (!count || count <= 0) return 0;
  return Math.min(150, Math.log2(1 + count) * 40);
}

export const DEFAULT_PALETTE_LIMIT = 12;

/**
 * Collate + rank actions and presets for one query.
 * Empty query: actions only, in the order App supplied them.
 * Ties rank actions above presets.
 */
export function buildPaletteResults({
  query,
  actions,
  presets,
  searchPresets,
  limit = DEFAULT_PALETTE_LIMIT,
  useCounts,
}: BuildPaletteResultsInput): PaletteResult[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    // Empty query: most-used actions first, authored order as the tiebreak.
    const ranked = actions.map((action, index) => ({
      action,
      index,
      boost: frecencyBoost(useCounts?.[`action:${action.id}`]),
    }));
    ranked.sort((a, b) => b.boost - a.boost || a.index - b.index);
    return ranked.slice(0, limit).map(({ action, boost }) => ({
      kind: 'action',
      id: `action:${action.id}`,
      action,
      score: boost,
    }));
  }

  const results: PaletteResult[] = [];

  for (const action of actions) {
    const score = scoreAction(trimmed, action);
    if (score !== null) {
      const id = `action:${action.id}`;
      results.push({
        kind: 'action',
        id,
        action,
        score: score + frecencyBoost(useCounts?.[id]),
      });
    }
  }

  const presetSource = searchPresets ? searchPresets(trimmed) : (presets ?? []);
  for (const preset of presetSource) {
    // A callback source already filtered by query; static entries are scored
    // here. Score callback results too so ordering is comparable across
    // kinds, but keep unmatched callback rows (score 0) — the source is the
    // authority on relevance for its own list.
    const score = scorePreset(trimmed, preset) ?? (searchPresets ? 0 : null);
    if (score !== null) {
      const id = `preset:${preset.id}`;
      results.push({
        kind: 'preset',
        id,
        preset,
        score: score + frecencyBoost(useCounts?.[id]),
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === 'action' ? -1 : 1;
    return 0;
  });

  return results.slice(0, limit);
}
