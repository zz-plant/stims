import type {
  MidiBindingMap,
  MidiNoteBindingMap,
} from '../core/services/webmidi-controller.ts';

export interface MidiDeviceProfile {
  id: string;
  name: string;
  manufacturer: string;
  description: string;
  ccBindings: MidiBindingMap;
  noteBindings?: MidiNoteBindingMap;
}

export const MIDI_CONTROLLER_PROFILES: MidiDeviceProfile[] = [
  {
    id: 'korg-nanokontrol2',
    name: 'Korg nanoKONTROL2',
    manufacturer: 'Korg',
    description:
      '8 knobs mapped to zoom, warp, rot, decay, and q1..q4; 8 faders mapped to motion dx/dy and video mixers.',
    ccBindings: {
      // 8 Knobs
      16: { target: 'zoom', min: 0.8, max: 1.3 },
      17: { target: 'warp', min: 0.0, max: 2.5 },
      18: { target: 'rot', min: -0.3, max: 0.3 },
      19: { target: 'decay', min: 0.85, max: 1.0 },
      20: { target: 'q1', min: 0.0, max: 1.0 },
      21: { target: 'q2', min: 0.0, max: 1.0 },
      22: { target: 'q3', min: 0.0, max: 1.0 },
      23: { target: 'q4', min: 0.0, max: 1.0 },
      // 8 Sliders
      0: { target: 'dx', min: -0.05, max: 0.05 },
      1: { target: 'dy', min: -0.05, max: 0.05 },
      2: { target: 'cx', min: 0.3, max: 0.7 },
      3: { target: 'cy', min: 0.3, max: 0.7 },
      4: { target: 'sx', min: 0.8, max: 1.2 },
      5: { target: 'sy', min: 0.8, max: 1.2 },
      6: { target: 'wave_a', min: 0.0, max: 1.0 },
      7: { target: 'crossfade', min: 0.0, max: 1.0 },
    },
  },
  {
    id: 'novation-launch-control-xl',
    name: 'Novation Launch Control XL',
    manufacturer: 'Novation',
    description:
      '24 knobs (3 rows) and 8 faders for deep real-time parameter tweaking.',
    ccBindings: {
      // Top Knob Row
      13: { target: 'zoom', min: 0.8, max: 1.3 },
      14: { target: 'warp', min: 0.0, max: 2.5 },
      15: { target: 'rot', min: -0.3, max: 0.3 },
      16: { target: 'decay', min: 0.85, max: 1.0 },
      17: { target: 'q1', min: 0.0, max: 1.0 },
      18: { target: 'q2', min: 0.0, max: 1.0 },
      19: { target: 'q3', min: 0.0, max: 1.0 },
      20: { target: 'q4', min: 0.0, max: 1.0 },
      // 8 Main Faders
      77: { target: 'dx', min: -0.05, max: 0.05 },
      78: { target: 'dy', min: -0.05, max: 0.05 },
      79: { target: 'cx', min: 0.3, max: 0.7 },
      80: { target: 'cy', min: 0.3, max: 0.7 },
      81: { target: 'sx', min: 0.8, max: 1.2 },
      82: { target: 'sy', min: 0.8, max: 1.2 },
      83: { target: 'wave_a', min: 0.0, max: 1.0 },
      84: { target: 'crossfade', min: 0.0, max: 1.0 },
    },
  },
  {
    id: 'arturia-minilab-3',
    name: 'Arturia MiniLab 3',
    manufacturer: 'Arturia',
    description:
      '8 rotary encoders and 4 faders mapped to primary visual parameters.',
    ccBindings: {
      // 8 Encoders
      86: { target: 'zoom', min: 0.8, max: 1.3 },
      87: { target: 'warp', min: 0.0, max: 2.5 },
      89: { target: 'rot', min: -0.3, max: 0.3 },
      90: { target: 'decay', min: 0.85, max: 1.0 },
      110: { target: 'q1', min: 0.0, max: 1.0 },
      111: { target: 'q2', min: 0.0, max: 1.0 },
      116: { target: 'q3', min: 0.0, max: 1.0 },
      117: { target: 'q4', min: 0.0, max: 1.0 },
      // 4 Faders
      73: { target: 'dx', min: -0.05, max: 0.05 },
      75: { target: 'dy', min: -0.05, max: 0.05 },
      79: { target: 'wave_a', min: 0.0, max: 1.0 },
      72: { target: 'crossfade', min: 0.0, max: 1.0 },
    },
  },
  {
    id: 'generic-dj-mixer',
    name: 'Generic 8-Knob DJ Controller',
    manufacturer: 'Generic',
    description:
      'Standard CC 1..8 knob mapping compatible with most DJ and MIDI gear.',
    ccBindings: {
      1: { target: 'zoom', min: 0.8, max: 1.3 },
      2: { target: 'warp', min: 0.0, max: 2.5 },
      3: { target: 'rot', min: -0.3, max: 0.3 },
      4: { target: 'decay', min: 0.85, max: 1.0 },
      5: { target: 'dx', min: -0.05, max: 0.05 },
      6: { target: 'dy', min: -0.05, max: 0.05 },
      7: { target: 'q1', min: 0.0, max: 1.0 },
      8: { target: 'crossfade', min: 0.0, max: 1.0 },
    },
  },
];

export function getMidiProfileById(id: string): MidiDeviceProfile | null {
  return MIDI_CONTROLLER_PROFILES.find((p) => p.id === id) ?? null;
}
