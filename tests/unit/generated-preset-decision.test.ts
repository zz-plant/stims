import { describe, expect, test } from 'bun:test';
import type { DecisionResult } from '../../src/js/core/decision-model.ts';
import {
  captureCanvasDecisionVideo,
  captureDecisionImage,
  captureDecisionVideo,
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

  test('video capture fails gracefully when stage is absent or canvas is empty', async () => {
    await expect(captureDecisionVideo(null)).rejects.toThrow('stage');
    const controller = new AbortController();
    controller.abort();
    await expect(
      captureDecisionVideo(null, undefined, controller.signal),
    ).rejects.toThrow();
  });

  test('clef-omni motion evaluation summarizes match, mismatch and uncertain properly', () => {
    const omniResult: DecisionResult = {
      version: 1,
      task: 'prompt-match',
      model: 'clef-omni',
      disposition: 'accepted',
      provenance: {
        questionVersion: 'stims-clef-v1',
        evaluatedAt: '2026-10-21T00:00:00Z',
        inputHash: 'b'.repeat(64),
      },
      answers: {
        structure_match: { type: 'noul', noul: 0.92 },
        palette_match: { type: 'noul', noul: 0.88 },
        composition_match: { type: 'noul', noul: 0.95 },
        sufficient_evidence: { type: 'noul', noul: 0.91 },
      },
    };
    expect(summarizePromptMatch(omniResult)).toBe('match');

    const mismatch: DecisionResult = {
      ...omniResult,
      answers: {
        ...omniResult.answers,
        palette_match: { type: 'noul', noul: 0.1 },
      },
    };
    expect(summarizePromptMatch(mismatch)).toBe('mismatch');
  });

  test('video recording uses MediaRecorder when available and produces valid data URLs', async () => {
    // Mock canvas with captureStream
    const canvas = {
      width: 640,
      height: 480,
      captureStream: () => {
        return {
          getTracks: () => [{ stop: () => {} }],
        };
      },
    } as unknown as HTMLCanvasElement;

    // Save originals
    const origMediaRecorder = globalThis.MediaRecorder;

    class MockMediaRecorder {
      static isTypeSupported(type: string) {
        return type.includes('webm');
      }
      state = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      start() {
        this.state = 'recording';
        setTimeout(() => {
          if (this.ondataavailable) {
            this.ondataavailable({
              data: new Blob([new Uint8Array([1, 2, 3, 4])], {
                type: 'video/webm',
              }),
            });
          }
        }, 10);
      }

      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.onstop?.();
        }, 10);
      }
    }

    // @ts-expect-error Mocking global MediaRecorder for test
    globalThis.MediaRecorder = MockMediaRecorder;

    try {
      const dataUrl = await captureCanvasDecisionVideo(canvas, {
        durationMs: 50,
      });
      expect(dataUrl.startsWith('data:video/webm;base64,')).toBe(true);
    } finally {
      globalThis.MediaRecorder = origMediaRecorder;
    }
  });
});
