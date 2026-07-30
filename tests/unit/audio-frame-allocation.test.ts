import { describe, expect, test } from 'bun:test';
import { createMilkdropAudioSignalProcessor } from '../../src/js/milkdrop/audio-signal-processor.ts';
import { createBeatTracker } from '../../src/js/utils/audio/beat.ts';

describe('audio frame allocation reuse', () => {
  test('reuses beat update and smoothed-band snapshots', () => {
    const tracker = createBeatTracker();
    const input = {
      bands: { bass: 0.4, mid: 0.2, treble: 0.1 },
      weightedEnergy: 0.35,
      deltaMs: 16.67,
    };

    const first = tracker.update(input, 16.67);
    const firstBands = first.smoothedBands;
    const second = tracker.update(input, 33.34);

    expect(second).toBe(first);
    expect(second.smoothedBands).toBe(firstBands);
  });

  test('reuses MilkDrop signal processor output and attenuation snapshots', () => {
    const processor = createMilkdropAudioSignalProcessor();
    const frequencyData = new Uint8Array(128);
    frequencyData.fill(96);

    const first = processor.update({
      analyser: null,
      frequencyData,
      sampleRate: 48_000,
      deltaMs: 16.67,
    });
    const firstAttenuation = first.attenuatedBands;
    const second = processor.update({
      analyser: null,
      frequencyData,
      sampleRate: 48_000,
      deltaMs: 16.67,
    });

    expect(second).toBe(first);
    expect(second.attenuatedBands).toBe(firstAttenuation);
  });
});
