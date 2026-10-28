/**
 * Clef Omni audio-match decision service.
 * Ranks candidate presets against explicit audio evidence.
 */
import {
  chosenOption,
  type DecisionRequest,
  type DecisionResult,
} from '../decision-model.ts';
import { requestDecision } from './decision-client.ts';

export interface AudioMatchCandidate {
  id: string;
  description: string;
}

export interface ClefAudioMatchResult {
  presetId: string | null;
  confidence: number;
  disposition: 'accepted' | 'review';
  reason?: string;
  result?: DecisionResult;
}

export async function matchAudioWithClefOmni(
  audioDataUrl: string,
  candidates: AudioMatchCandidate[],
  options?: { signal?: AbortSignal; endpoint?: string },
): Promise<ClefAudioMatchResult> {
  if (!candidates.length) {
    return {
      presetId: null,
      confidence: 0,
      disposition: 'review',
      reason: 'No candidate presets were provided.',
    };
  }

  // Bounded to 1-12 candidates per decision-model limits
  const shortlist = candidates.slice(0, 12).map((c) => ({
    id: c.id,
    description: c.description.slice(0, 1000) || c.id,
  }));

  const request: DecisionRequest = {
    task: 'audio-match',
    state: {
      candidates: shortlist,
    },
    audio: [audioDataUrl],
  };

  const result = await requestDecision(request, {
    signal: options?.signal,
    endpoint: options?.endpoint,
  });

  const answer = result.answers.candidate;
  const rawChoice = answer && answer.type === 'choice' ? answer.choice : null;
  const confidence = answer && answer.type === 'choice' ? answer.confidence : 0;

  if (rawChoice === 'hold') {
    return {
      presetId: null,
      confidence,
      disposition: result.disposition,
      reason: 'Model abstained: sound evidence was ambiguous or insufficient.',
      result,
    };
  }

  if (rawChoice === 'none') {
    return {
      presetId: null,
      confidence,
      disposition: result.disposition,
      reason: 'None of the offered presets matched the music character.',
      result,
    };
  }

  const selected = chosenOption(result, 'candidate');
  if (!selected) {
    return {
      presetId: null,
      confidence,
      disposition: result.disposition,
      reason: 'Decision was not accepted or lacked decisive evidence.',
      result,
    };
  }

  const matched = shortlist.find((c) => c.id === selected);
  if (!matched) {
    return {
      presetId: null,
      confidence,
      disposition: 'review',
      reason: 'Selected option was not in the candidate shortlist.',
      result,
    };
  }

  return {
    presetId: matched.id,
    confidence,
    disposition: result.disposition,
    result,
  };
}
