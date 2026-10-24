/**
 * LL-01 retrieval half: turn a reference description into a bounded shortlist
 * of editable catalog presets, and let Clef validate that shortlist against an
 * actual reference image.
 *
 * The description path is entirely on-device: the static EmbeddingGemma 2
 * preview vectors (visual terms) and the same text scorer Browse ranks with.
 * Nothing leaves the device, so retrieval keeps working offline and while any
 * encoder is unavailable. The image path sends only the explicitly chosen
 * image plus the candidate descriptions to the hosted decision service; the
 * `reference-choice` task owns its schema (see decision-model.ts).
 *
 * Matching space does not imply matching thresholds: the image-neighbor
 * cutoff (`VISUAL_MATCH_MIN_SCORE`) is not applied to text/term retrieval.
 * Component scores are kept separate and combined by the versioned policy
 * below rather than averaged into one vector.
 */

import { chosenOption, type DecisionResult } from '../core/decision-model.ts';
import { requestDecision } from '../core/services/decision-client.ts';
import { resolveOptionalApiUrl } from '../core/services/optional-api.ts';
import {
  scoreVisualQuery,
  VISUAL_TERM_MATCH_Z,
} from '../core/services/preset-visual-vectors.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { createFieldMatcher, scorePresetEntry } from './workspace-helpers.ts';

/** Combine policy for slice 1: presets that name the reference rank above
 * presets whose preview merely resembles it; each component score is
 * preserved on the candidate. Bump this when the merge changes. */
export const REFERENCE_COMBINE_POLICY = 'reference-remix-v1' as const;

/** Server cap on offered candidates; retrieval never exceeds it. */
export const REFERENCE_MAX_CANDIDATES = 12 as const;

/** Hosted-call budget for one Clef selection. */
export const REFERENCE_DECISION_TIMEOUT_MS = 30_000 as const;

export type ReferenceCandidate = {
  presetId: string;
  /** Text-match strength (scorePresetEntry) or null when only visual. */
  textScore: number | null;
  /** Visual-term z-score or null when the query had no visual terms. */
  visualZ: number | null;
  /** "text", "visual", or "both" — why this preset was retrieved. */
  reason: 'text' | 'visual' | 'both';
  entry: PresetCatalogEntry | null;
};

export type ReferenceShortlist = {
  policy: typeof REFERENCE_COMBINE_POLICY;
  query: string;
  candidates: ReferenceCandidate[];
  /** True when no catalog preset plausibly matches the reference. */
  empty: boolean;
};

/**
 * Rank the catalog against a reference description on the device. The query
 * is folded the way Browse folds text; presets that name the reference come
 * first (by text score), then presets whose preview matches the visual terms
 * of the query (by z-score). A query that is not made of visual terms gets no
 * visual scores, so "geiss tunnel" never ranks the whole catalog by
 * tunnel-ness behind the author hit.
 */
export async function retrieveReferenceCandidates(
  description: string,
  catalog: readonly PresetCatalogEntry[],
  options: { topK?: number; signal?: AbortSignal } = {},
): Promise<ReferenceShortlist> {
  options.signal?.throwIfAborted();
  const topK = Math.min(
    REFERENCE_MAX_CANDIDATES,
    Math.max(1, options.topK ?? 8),
  );
  const query = description.trim();
  if (!query || catalog.length === 0) {
    return {
      policy: REFERENCE_COMBINE_POLICY,
      query,
      candidates: [],
      empty: true,
    };
  }

  const matcher = createFieldMatcher(query, { allowSubsequence: false });
  const visualScores = await scoreVisualQuery(query);
  options.signal?.throwIfAborted();

  const ranked: ReferenceCandidate[] = [];
  for (const entry of catalog) {
    const textScore = scorePresetEntry(entry, matcher);
    const visualZ = visualScores.get(entry.id) ?? null;
    const visualMatch = visualZ !== null && visualZ >= VISUAL_TERM_MATCH_Z;
    if (textScore === null && !visualMatch) continue;
    ranked.push({
      presetId: entry.id,
      textScore,
      visualZ: visualMatch ? visualZ : null,
      reason:
        textScore !== null && visualMatch
          ? 'both'
          : textScore !== null
            ? 'text'
            : 'visual',
      entry,
    });
  }

  ranked.sort((a, b) => {
    const aText = a.textScore !== null ? 0 : 1;
    const bText = b.textScore !== null ? 0 : 1;
    if (aText !== bText) return aText - bText;
    const aScore = a.textScore ?? a.visualZ ?? Number.NEGATIVE_INFINITY;
    const bScore = b.textScore ?? b.visualZ ?? Number.NEGATIVE_INFINITY;
    if (aScore === bScore) return a.presetId.localeCompare(b.presetId);
    return aScore > bScore ? -1 : 1;
  });

  return {
    policy: REFERENCE_COMBINE_POLICY,
    query,
    candidates: ranked.slice(0, topK),
    empty: ranked.length === 0,
  };
}

export type ReferenceChoiceOutcome =
  | { kind: 'chosen'; presetId: string; result: DecisionResult }
  | { kind: 'abstained'; result: DecisionResult | null }
  | { kind: 'unavailable'; message: string };

/**
 * Ask Clef to pick among a retrieved shortlist against an actual reference
 * image. Sends only the chosen image and the candidate descriptions; `hold`
 * and `none` abstain (a similarity score is not a claim of reproduction).
 */
export async function chooseReferenceWithClef(options: {
  image: string;
  /** The reference description; bounded context for the model. */
  description?: string;
  candidates: ReferenceCandidate[];
  signal?: AbortSignal;
  endpoint?: string | null;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<ReferenceChoiceOutcome> {
  const endpoint =
    options.endpoint === undefined
      ? resolveOptionalApiUrl('/api/decide')
      : options.endpoint;
  if (!endpoint) {
    return {
      kind: 'unavailable',
      message: 'Clef selection needs a configured hosted API.',
    };
  }
  if (options.candidates.length === 0) {
    return { kind: 'abstained', result: null };
  }
  const offered = options.candidates
    .slice(0, REFERENCE_MAX_CANDIDATES)
    .map((candidate) => ({
      id: candidate.presetId,
      description:
        candidate.entry?.searchTerms?.join(', ') ||
        candidate.entry?.title ||
        candidate.presetId,
    }));
  try {
    const result = await requestDecision(
      {
        task: 'reference-choice',
        state: {
          candidates: offered,
          reference: (options.description ?? '').trim().slice(0, 1000),
        },
        images: [options.image],
      },
      {
        signal: options.signal,
        endpoint: options.endpoint,
        fetcher: options.fetcher,
        timeoutMs: REFERENCE_DECISION_TIMEOUT_MS,
      },
    );
    const chosen = chosenOption(result);
    return chosen
      ? { kind: 'chosen', presetId: chosen, result }
      : { kind: 'abstained', result };
  } catch (error) {
    if (options.signal?.aborted) {
      return { kind: 'unavailable', message: 'Selection cancelled.' };
    }
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : 'Selection failed.',
    };
  }
}
