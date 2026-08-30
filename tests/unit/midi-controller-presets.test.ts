import { describe, expect, test } from 'bun:test';
import {
  getMidiProfileById,
  MIDI_CONTROLLER_PROFILES,
} from '../../src/js/frontend/midi-controller-presets.ts';

describe('midi controller presets', () => {
  test('defines standard controller profiles', () => {
    expect(MIDI_CONTROLLER_PROFILES.length).toBeGreaterThanOrEqual(4);
    const nano = getMidiProfileById('korg-nanokontrol2');
    expect(nano).not.toBeNull();
    expect(nano?.ccBindings[16].target).toBe('zoom');
    expect(nano?.ccBindings[17].target).toBe('warp');
  });

  test('resolves profile by ID correctly', () => {
    const launch = getMidiProfileById('novation-launch-control-xl');
    expect(launch).not.toBeNull();
    expect(launch?.manufacturer).toBe('Novation');

    const unknown = getMidiProfileById('non-existent');
    expect(unknown).toBeNull();
  });
});
