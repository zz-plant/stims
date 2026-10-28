import { describe, expect, test } from 'bun:test';
import type { DecisionResult } from '../../src/js/core/decision-model.ts';
import {
  createSyntheticAudioClip,
  encodePcmToWav,
  wavToDataUrl,
} from '../../src/js/core/services/audio-clip.ts';
import { matchAudioWithClefOmni } from '../../src/js/core/services/decision-audio-match.ts';

function audioChoice(
  candidates: Array<{ id: string }>,
  option: string,
  confidence = 0.95,
  disposition?: DecisionResult['disposition'],
): DecisionResult {
  const allKeys = Array.from(
    new Set([...candidates.map((c) => c.id), 'hold', 'none']),
  );
  const remainingKeys = allKeys.filter((k) => k !== option);
  const remainingProb =
    remainingKeys.length > 0 ? (1 - confidence) / remainingKeys.length : 0;
  const probabilities = Object.fromEntries(
    allKeys.map((k) => [k, k === option ? confidence : remainingProb]),
  );
  const isAbstain = ['hold', 'none', 'unclear'].includes(option);
  const resolvedDisposition =
    disposition ?? (isAbstain ? 'review' : 'accepted');
  return {
    version: 1,
    task: 'audio-match',
    model: 'clef-omni',
    disposition: resolvedDisposition,
    provenance: {
      questionVersion: 'stims-clef-v1',
      evaluatedAt: '2026-10-21T00:00:00Z',
      inputHash: 'c'.repeat(64),
    },
    answers: {
      candidate: {
        type: 'choice',
        choice: option,
        confidence,
        probabilities,
      },
      sufficient_evidence: { type: 'noul', noul: 0.95 },
    },
  };
}

describe('clef-omni audio preset matching', () => {
  test('pcm to wav encoding produces a valid RIFF WAVE buffer and data url', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.9, -0.9]);
    const wav = encodePcmToWav(samples, 16000);
    expect(wav.byteLength).toBe(44 + 5 * 2);

    const view = new DataView(wav);
    // RIFF
    expect(
      String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      ),
    ).toBe('RIFF');
    // WAVE
    expect(
      String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11),
      ),
    ).toBe('WAVE');

    const dataUrl = wavToDataUrl(wav);
    expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
  });

  test('createSyntheticAudioClip produces compact wav data url', () => {
    const clip = createSyntheticAudioClip({ durationMs: 500 });
    expect(clip.startsWith('data:audio/wav;base64,')).toBe(true);
    // 500ms @ 16kHz = 8000 samples = 16000 bytes. Base64 is ~21KB.
    expect(clip.length).toBeGreaterThan(1000);
    expect(clip.length).toBeLessThan(50000);
  });

  test('matchAudioWithClefOmni rejects empty candidates without calling API', async () => {
    const clip = createSyntheticAudioClip();
    const res = await matchAudioWithClefOmni(clip, []);
    expect(res.presetId).toBeNull();
    expect(res.reason).toContain('No candidate');
  });

  test('matchAudioWithClefOmni parses winning candidate from Clef Omni', async () => {
    const clip = createSyntheticAudioClip();
    const candidates = [
      { id: 'eos-ether', description: 'flowing tranquil ether waves' },
      { id: 'geiss-casino', description: 'high energy bright casino' },
    ];

    // Mock global fetch
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify(audioChoice(candidates, 'eos-ether', 0.92)),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const res = await matchAudioWithClefOmni(clip, candidates, {
        endpoint: 'https://example.com/api/decide',
      });
      expect(res.presetId).toBe('eos-ether');
      expect(res.confidence).toBe(0.92);
      expect(res.disposition).toBe('accepted');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('matchAudioWithClefOmni handles hold and none appropriately', async () => {
    const clip = createSyntheticAudioClip();
    const candidates = [{ id: 'eos-ether', description: 'flowing ether' }];

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify(audioChoice(candidates, 'hold', 0.85)),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }) as unknown as typeof fetch;

      const holdRes = await matchAudioWithClefOmni(clip, candidates, {
        endpoint: 'https://example.com/api/decide',
      });
      expect(holdRes.presetId).toBeNull();
      expect(holdRes.reason).toContain('abstained');

      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify(audioChoice(candidates, 'none', 0.88)),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }) as unknown as typeof fetch;

      const noneRes = await matchAudioWithClefOmni(clip, candidates, {
        endpoint: 'https://example.com/api/decide',
      });
      expect(noneRes.presetId).toBeNull();
      expect(noneRes.reason).toContain('None of the offered');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
