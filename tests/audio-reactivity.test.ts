import { describe, expect, test } from 'bun:test';
import { getFrequencyBandLevels } from '../assets/js/utils/audio-reactivity.ts';

function makeSpectrumPulse({
  activeBin,
  magnitude = 255,
  length = 256,
}: {
  activeBin: number;
  magnitude?: number;
  length?: number;
}) {
  const data = new Uint8Array(length);
  data.fill(0);
  if (activeBin >= 0 && activeBin < length) {
    data[activeBin] = magnitude;
  }
  return data;
}

describe('audio reactivity band extraction', () => {
  test('maps low, mid, and high frequency bins into the expected bands', () => {
    const sampleRate = 48_000;

    const bass = getFrequencyBandLevels(
      makeSpectrumPulse({ activeBin: 2 }),
      sampleRate,
    );
    const mid = getFrequencyBandLevels(
      makeSpectrumPulse({ activeBin: 18 }),
      sampleRate,
    );
    const treble = getFrequencyBandLevels(
      makeSpectrumPulse({ activeBin: 72 }),
      sampleRate,
    );

    expect(bass.bass).toBeGreaterThan(bass.mid);
    expect(bass.bass).toBeGreaterThan(bass.treble);
    expect(mid.mid).toBeGreaterThan(mid.bass);
    expect(mid.mid).toBeGreaterThan(mid.treble);
    expect(treble.treble).toBeGreaterThan(treble.bass);
    expect(treble.treble).toBeGreaterThan(treble.mid);
  });
});
