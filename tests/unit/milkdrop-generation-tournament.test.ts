import { afterEach, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  generatePresetTournament,
  scoreGenerationCandidate,
} from '../../src/js/milkdrop/preset-generator.ts';
import { probePresetReactivity } from '../../src/js/milkdrop/reactivity-probe.ts';

const REACTIVE_SOURCE = `[preset00]
fRating=5.0
fDecay=0.98
per_frame_1=zoom=1.02+bass_att*0.02
per_pixel_1=zoom=(zoom-1)*rad+1
`;

const STATIC_SOURCE = `[preset00]
fRating=5.0
fDecay=0.98
per_frame_1=zoom=1.02
`;

// per_frame_1 has an unbalanced parenthesis; per_frame_2 is fine, so this
// source is salvageable (one dropped line) rather than a total loss.
const SALVAGEABLE_SOURCE = `[preset00]
fRating=5.0
per_frame_1=zoom = 1.01 + 0.02*sin(time
per_frame_2=rot = 0.1*bass_att;
`;

// fRating is not an equation key, so a parse error here can't be salvaged
// by dropping a line — this candidate must be eliminated outright.
const UNSALVAGEABLE_SOURCE = `[preset00]
fRating=(unbalanced
per_frame_1=zoom=1.02
`;

function hostedResponse(milkSource: string) {
  return Response.json({ milkSource });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('scoreGenerationCandidate', () => {
  test('ranks a reactive candidate above a static one', () => {
    const reactive = compileMilkdropPresetSource(REACTIVE_SOURCE, {
      id: 'r',
      title: 'r',
      origin: 'generated',
    });
    const staticPreset = compileMilkdropPresetSource(STATIC_SOURCE, {
      id: 's',
      title: 's',
      origin: 'generated',
    });
    const reactiveProbe = probePresetReactivity(reactive, { verify: true });
    const staticProbe = probePresetReactivity(staticPreset, { verify: true });

    expect(reactiveProbe.verdict).toBe('reactive');
    expect(staticProbe.verdict).toBe('static');
    expect(
      scoreGenerationCandidate(reactive, reactiveProbe, 0),
    ).toBeGreaterThan(scoreGenerationCandidate(staticPreset, staticProbe, 0));
  });

  test('penalizes a candidate that needed lines dropped', () => {
    const preset = compileMilkdropPresetSource(REACTIVE_SOURCE, {
      id: 'r',
      title: 'r',
      origin: 'generated',
    });
    const probe = probePresetReactivity(preset, { verify: true });
    expect(scoreGenerationCandidate(preset, probe, 0)).toBeGreaterThan(
      scoreGenerationCandidate(preset, probe, 3),
    );
  });
});

describe('generatePresetTournament', () => {
  test('picks the reactive candidate over static and salvaged ones', async () => {
    let call = 0;
    const responses = [STATIC_SOURCE, REACTIVE_SOURCE, SALVAGEABLE_SOURCE];
    const fetchMock = mock(async () =>
      hostedResponse(responses[call++] as string),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await generatePresetTournament('bass-reactive rings', {
      provider: { kind: 'hosted' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcome.attempted).toBe(3);
    expect(outcome.survivors).toBe(3);
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.probe.verdict).toBe('reactive');
    expect(outcome.winner.source.raw).toBe(REACTIVE_SOURCE.trim());
  }, 30_000);

  test('eliminates unsalvageable candidates but still wins on the rest', async () => {
    let call = 0;
    const responses = [UNSALVAGEABLE_SOURCE, REACTIVE_SOURCE, STATIC_SOURCE];
    const fetchMock = mock(async () =>
      hostedResponse(responses[call++] as string),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await generatePresetTournament('rings', {
      provider: { kind: 'hosted' },
    });

    expect(outcome.attempted).toBe(3);
    expect(outcome.survivors).toBe(2);
    expect(outcome.winner.source.raw).toBe(REACTIVE_SOURCE.trim());
  }, 30_000);

  test('falls back to the template synthesizer when every candidate fails', async () => {
    const fetchMock = mock(async () => hostedResponse(UNSALVAGEABLE_SOURCE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await generatePresetTournament('rings', {
      provider: { kind: 'hosted' },
      fallbackToTemplate: true,
    });

    expect(outcome.survivors).toBe(0);
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.winner.source.raw).toContain('[preset00]');
  }, 30_000);

  test('throws with every failure reason when all candidates fail and there is no fallback', async () => {
    const fetchMock = mock(async () => hostedResponse(UNSALVAGEABLE_SOURCE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generatePresetTournament('rings', { provider: { kind: 'hosted' } }),
    ).rejects.toThrow(/All 3 generation attempts failed/);
  });

  test('requests fewer candidates for the local openai-compatible provider', async () => {
    const fetchMock = mock(async () =>
      Response.json({ choices: [{ message: { content: REACTIVE_SOURCE } }] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await generatePresetTournament('rings', {
      provider: {
        kind: 'openai-compatible',
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'gemma4:26b',
      },
    });

    expect(outcome.attempted).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  test('respects an explicit candidateCount override', async () => {
    const fetchMock = mock(async () => hostedResponse(REACTIVE_SOURCE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await generatePresetTournament('rings', {
      provider: { kind: 'hosted' },
      candidateCount: 1,
    });

    expect(outcome.attempted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 30_000);
});
