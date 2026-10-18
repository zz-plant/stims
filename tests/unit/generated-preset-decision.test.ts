import { describe, expect, test } from 'bun:test';
import type { DecisionResult } from '../../src/js/core/decision-model.ts';
import {
  captureDecisionImage,
  summarizePromptMatch,
} from '../../src/js/frontend/generated-preset-decision.ts';

function result(
  structure: number,
  disposition: DecisionResult['disposition'] = 'accepted',
): DecisionResult {
  return {
    version: 1,
    task: 'prompt-match',
    model: 'clef-flash',
    disposition,
    provenance: {
      questionVersion: 'stims-clef-v1',
      evaluatedAt: '2026-10-17T00:00:00Z',
      inputHash: 'a'.repeat(64),
    },
    answers: {
      structure_match: { type: 'noul', noul: structure },
      palette_match: { type: 'noul', noul: 0.95 },
      composition_match: { type: 'noul', noul: 0.96 },
      sufficient_evidence: { type: 'noul', noul: 0.95 },
    },
  };
}

describe('generated preset picture review', () => {
  test('a decisive negative answer is a mismatch even though the judgment is accepted', () => {
    expect(summarizePromptMatch(result(0.05))).toBe('mismatch');
    expect(summarizePromptMatch(result(0.95))).toBe('match');
    expect(summarizePromptMatch(result(0.6, 'review'))).toBe('uncertain');
  });

  test('missing evidence or a different task cannot establish a match', () => {
    const incomplete = result(0.95);
    delete incomplete.answers.sufficient_evidence;
    expect(summarizePromptMatch(incomplete)).toBe('uncertain');
    expect(
      summarizePromptMatch({ ...result(0.95), task: 'capture-review' }),
    ).toBe('uncertain');
  });

  test('an absent stage fails without recording or transmitting anything', async () => {
    await expect(captureDecisionImage(null)).rejects.toThrow('stage');
  });

  test('cancellation is checked before a stage read', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      captureDecisionImage(null, controller.signal),
    ).rejects.toThrow();
  });
});
