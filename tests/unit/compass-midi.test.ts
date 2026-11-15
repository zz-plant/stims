import { describe, expect, test } from 'bun:test';
import { midiCcToUnit } from '../../src/js/frontend/hooks/use-compass-midi.ts';

describe('compass MIDI mapping', () => {
  test('0 -> -1, 127 -> 1, 64 -> near 0', () => {
    expect(midiCcToUnit(0)).toBe(-1);
    expect(midiCcToUnit(127)).toBe(1);
    expect(midiCcToUnit(64)).toBeCloseTo(0.0079, 3);
  });

  test('clamps out-of-range', () => {
    expect(midiCcToUnit(-5)).toBe(-1);
    expect(midiCcToUnit(200)).toBe(1);
  });
});
