import { describe, expect, test } from 'bun:test';
import {
  chosenOption,
  decisionDisposition,
  decisionQuestions,
  parseDecisionAnswers,
  parseDecisionRequest,
  parseDecisionResult,
  safeParseDecisionRequest,
} from '../../src/js/core/decision-model.ts';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const audio = 'data:audio/wav;base64,UklGRgAAAABXQVZF';
const request = {
  task: 'audio-match',
  state: { candidates: [{ id: 'preset-a', description: 'slow radial forms' }] },
  audio: [audio],
};
const answers = {
  candidate: {
    type: 'choice',
    choice: 'preset-a',
    probabilities: { 'preset-a': 0.9, hold: 0.05, none: 0.05 },
    confidence: 0.9,
  },
  sufficient_evidence: { type: 'noul', noul: 0.95 },
};

describe('decision request contract', () => {
  test('rejects nonstring tasks without coercing JSON values', () => {
    for (const task of [['capture-review'], null, {}, 1]) {
      expect(
        safeParseDecisionRequest({ task, state: {}, images: [image] }).success,
      ).toBe(false);
    }
  });
  test('defaults images to Flash and upgrades audio to Omni', () => {
    expect(
      parseDecisionRequest({
        task: 'visual-profile',
        state: {},
        images: [image],
      }).model,
    ).toBe('clef-flash');
    expect(
      parseDecisionRequest({ ...request, model: 'clef-flash' }).model,
    ).toBe('clef-omni');
  });

  test('requires task-specific evidence and rejects arbitrary questions/models', () => {
    for (const value of [
      { task: 'visual-profile', state: {} },
      { task: 'prompt-match', state: {}, images: [image] },
      { ...request, audio: [], videos: ['data:video/webm;base64,GkXfow=='] },
      { ...request, questions: { arbitrary: {} } },
      { ...request, model: '@cf/arbitrary/model' },
      { ...request, images: ['https://example.com/image.png'] },
      { ...request, audio: ['data:audio/wav;base64,!!!!'] },
      { ...request, audio: ['data:audio/wav;base64,AB=='] },
      {
        ...request,
        state: { candidates: [{ id: 'hold', description: 'reserved' }] },
      },
      {
        ...request,
        state: {
          candidates: [
            { id: 'a', description: 'one' },
            { id: 'a', description: 'two' },
          ],
        },
      },
      {
        ...request,
        state: {
          candidates: Array.from({ length: 13 }, (_, i) => ({
            id: `a${i}`,
            description: 'candidate',
          })),
        },
      },
      {
        task: 'prompt-match',
        state: { prompt: 'x'.repeat(4097) },
        images: [image],
      },
      {
        ...request,
        state: { candidates: request.state.candidates, bad: Number.NaN },
      },
    ])
      expect(safeParseDecisionRequest(value).success).toBe(false);
  });

  test('allows video evidence with an explicit soundtrack declaration', () => {
    expect(
      parseDecisionRequest({
        ...request,
        audio: [],
        videos: ['data:video/webm;base64,GkXfow=='],
        state: { ...request.state, videoHasAudio: true },
      }).model,
    ).toBe('clef-omni');
  });

  test('asks overlapping visual motifs independently and bounds scene options', () => {
    const visual = decisionQuestions(
      parseDecisionRequest({
        task: 'visual-profile',
        state: {},
        images: [image],
      }),
    );
    expect(visual.motif_tunnel.type).toBe('noul');
    expect(visual.motif_radial.type).toBe('noul');
    const scene = decisionQuestions(
      parseDecisionRequest({
        task: 'scene-choice',
        state: {
          scenes: [{ id: 'scene-a', description: 'quiet' }],
          currentSceneId: 'scene-a',
        },
        audio: [audio],
      }),
    );
    expect(scene.scene).toMatchObject({
      type: 'choice',
      criteria: { 'scene-a': 'quiet', hold: expect.any(String) },
    });
    expect(() =>
      parseDecisionRequest({
        task: 'scene-choice',
        state: {
          scenes: [{ id: 'a', description: 'quiet' }],
          currentSceneId: 'missing',
        },
        audio: [audio],
      }),
    ).toThrow();
  });
});

describe('decision answer validation', () => {
  test('validates known choices and accepts a sufficiently decisive result', () => {
    const parsed = parseDecisionRequest(request);
    const validated = parseDecisionAnswers(answers, decisionQuestions(parsed));
    expect(decisionDisposition(parsed.task, validated)).toBe('accepted');
    const result = parseDecisionResult(
      {
        version: 1,
        task: parsed.task,
        model: parsed.model,
        answers,
        disposition: 'accepted',
        provenance: {
          questionVersion: 'stims-clef-v1',
          evaluatedAt: '2026-10-17T00:00:00.000Z',
          inputHash: 'a'.repeat(64),
        },
      },
      parsed,
    );
    expect(chosenOption(result)).toBe('preset-a');
  });

  test('rejects unknown or missing options, inconsistent winners, and non-normalized probabilities', () => {
    const questions = decisionQuestions(parseDecisionRequest(request));
    for (const candidate of [
      { ...answers.candidate, choice: 'unoffered' },
      { ...answers.candidate, probabilities: { 'preset-a': 0.9, hold: 0.1 } },
      {
        ...answers.candidate,
        probabilities: { 'preset-a': 0.9, hold: 0.05, none: 0.05, other: 0 },
      },
      {
        ...answers.candidate,
        probabilities: { 'preset-a': 0.1, hold: 0.85, none: 0.05 },
      },
      {
        ...answers.candidate,
        probabilities: { 'preset-a': 0.9, hold: 0.9, none: 0.9 },
      },
      { ...answers.candidate, confidence: Number.NaN },
    ])
      expect(() =>
        parseDecisionAnswers({ ...answers, candidate }, questions),
      ).toThrow();
    expect(() =>
      parseDecisionAnswers(
        { ...answers, sufficient_evidence: { type: 'noul', noul: 1.1 } },
        questions,
      ),
    ).toThrow();
    expect(() =>
      parseDecisionAnswers({ candidate: answers.candidate }, questions),
    ).toThrow();
  });

  test('abstains for hold, uncertain distribution, and insufficient evidence', () => {
    const task = parseDecisionRequest(request).task;
    for (const value of [
      { ...answers, sufficient_evidence: { type: 'noul' as const, noul: 0.6 } },
      {
        ...answers,
        candidate: {
          type: 'choice' as const,
          choice: 'hold',
          probabilities: { 'preset-a': 0.05, hold: 0.9, none: 0.05 },
          confidence: 0.95,
        },
      },
      {
        ...answers,
        candidate: {
          type: 'choice' as const,
          choice: 'preset-a',
          probabilities: { 'preset-a': 0.5, hold: 0.45, none: 0.05 },
          confidence: 0.99,
        },
      },
    ])
      expect(
        decisionDisposition(
          task,
          parseDecisionAnswers(
            value,
            decisionQuestions(parseDecisionRequest(request)),
          ),
        ),
      ).toBe('review');
  });

  test('checks weighted scores against the actual rubric levels', () => {
    const questions = {
      complexity: {
        type: 'score' as const,
        instructions: 'Complexity',
        criteria: ['low', 'medium', 'high'],
      },
    };
    const value = {
      complexity: {
        type: 'score',
        score: 1.8,
        probabilities: { '0': 0, '1': 0.2, '2': 0.8 },
        confidence: 0.8,
        legend: { '0': 'low', '1': 'medium', '2': 'high' },
      },
    };
    expect(parseDecisionAnswers(value, questions).complexity).toMatchObject({
      score: 1.8,
    });
    expect(() =>
      parseDecisionAnswers(
        { complexity: { ...value.complexity, score: 9 } },
        questions,
      ),
    ).toThrow();
    expect(() =>
      parseDecisionAnswers(
        { complexity: { ...value.complexity, score: 0 } },
        questions,
      ),
    ).toThrow();
    expect(() =>
      parseDecisionAnswers(
        {
          complexity: {
            ...value.complexity,
            legend: { '0': 'low', '1': 'medium', '2': 'wrong' },
          },
        },
        questions,
      ),
    ).toThrow();
  });
});
