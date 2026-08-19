// Command palette result sources + matching. Pure module (no React): App
// supplies actions and preset sources, CommandPalette.tsx calls
// buildPaletteResults per keystroke. Kept separate from the component so the
// ranking logic is unit-testable and App can type its action list against
// CommandAction without importing the component.

import { FIELD_PENALTY, scoreFields, toMatchField } from './preset-matching.ts';

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
 * Case-insensitive tiered score for `query` against a single `text`.
 * Returns null on no match. Higher is better:
 *   - exact match > prefix > word-start substring > substring > subsequence
 *   - shorter targets rank slightly higher (tighter match)
 *
 * Kept as a one-field call into the shared matcher so the palette and the
 * browse filter rank the same query identically.
 */
export function scoreMatch(query: string, text: string): number | null {
  return scoreFields(query, [toMatchField(text)]);
}

function scoreAction(query: string, action: CommandAction): number | null {
  // Keyword hits rank a notch under equivalent label hits.
  return scoreFields(query, [
    toMatchField(action.label),
    ...(action.keywords ?? []).map((keyword) =>
      toMatchField(keyword, FIELD_PENALTY.keyword),
    ),
  ]);
}

function scorePreset(
  query: string,
  preset: PalettePresetResult,
): number | null {
  // Multi-token queries AND across these fields, so "geiss dream" finds a
  // Geiss-authored preset titled Dream — the browse filter always did.
  return scoreFields(query, [
    toMatchField(preset.title, FIELD_PENALTY.title),
    toMatchField(preset.author ?? '', FIELD_PENALTY.author),
  ]);
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
