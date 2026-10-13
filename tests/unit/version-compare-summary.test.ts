import { describe, expect, test } from 'bun:test';
import {
  formatAudioReachSummary,
  MAX_AUDIO_REACH_LINES,
  summarizeAudioReach,
} from '../../src/js/milkdrop/overlay/version-compare-summary.ts';

/**
 * The History tab's compare flow annotates the line diff with a
 * plain-language reading of how the preset's relationship with the music
 * changed — derived from the audio-reach sets of the two sources, the same
 * static dataflow the per-control chips use.
 */

// Both sides need distinct titles: the compiler caches by source text, so
// two tests cannot share one text under the same id. Equations are what the
// dataflow reads; literals alone never change the reach.
let counter = 0;
const source = (equations: string[]) => {
  counter += 1;
  return `[preset]\ntitle=reach-test-${counter}\nzoom=1.0\n[preset]\n${equations.join('\n')}\n`;
};

const listensToBass = source(['per_frame_1=zoom = 1 + 0.1*bass;']);
const constant = source(['per_frame_1=zoom = 1.04;']);
const listensToMore = source([
  'per_frame_1=zoom = 1 + 0.1*bass + 0.05*mid;',
  'per_frame_2=warp = 1 + 0.05*mid;',
]);

describe('version compare audio-reach summary', () => {
  test('reports what stopped and started listening, in diff direction', () => {
    expect(summarizeAudioReach(listensToBass, constant)).toEqual([
      'zoom stopped listening to bass',
    ]);
    expect(summarizeAudioReach(constant, listensToBass)).toEqual([
      'zoom started listening to bass',
    ]);
    // A gained signal on a control that already listened says "started
    // listening to" for the new one only.
    expect(summarizeAudioReach(listensToBass, listensToMore)).toEqual([
      'zoom started listening to mid',
      'warp started listening to mid',
    ]);
    expect(summarizeAudioReach(listensToMore, listensToBass)).toEqual([
      'zoom stopped listening to mid',
      'warp stopped listening to mid',
    ]);
  });

  test('an identical source, a literal-only edit, and an unparseable side say nothing', () => {
    expect(summarizeAudioReach(listensToBass, listensToBass)).toEqual([]);
    // Only the literal changed: nothing about how it listens changed.
    const retuned = listensToBass.replace('zoom=1.0', 'zoom=1.05');
    expect(summarizeAudioReach(listensToBass, retuned)).toEqual([]);
    expect(summarizeAudioReach(constant, 'this is not a preset')).toEqual([]);
    expect(summarizeAudioReach('this is not a preset', constant)).toEqual([]);
  });

  test('a drawn part appearing or leaving is itself a listening change', () => {
    const withWave = source([
      'wavecode_0_enabled=1',
      'wave_0_per_point1=x = x + 0.2*treb;',
    ]);
    expect(summarizeAudioReach(withWave, constant)).toEqual([
      'wave_0 stopped drawing',
    ]);
    expect(summarizeAudioReach(constant, withWave)).toEqual([
      'wave_0 started drawing, listening to treb',
    ]);
  });

  test('caps its own length', () => {
    const keys = ['zoom', 'warp', 'rot', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy'];
    const everyControl = source(
      keys.map((key, i) => `per_frame_${i + 1}=${key} = ${key} + 0.1*bass;`),
    );
    const nothing = source(
      keys.map((key, i) => `per_frame_${i + 1}=${key} = 1;`),
    );
    const lines = summarizeAudioReach(everyControl, nothing);
    expect(lines).toHaveLength(MAX_AUDIO_REACH_LINES + 1);
    expect(lines[lines.length - 1]).toBe(
      `and ${keys.length - MAX_AUDIO_REACH_LINES} more`,
    );
  });

  test('formats the lines as one sentence', () => {
    expect(formatAudioReachSummary(['zoom stopped listening to bass'])).toBe(
      'zoom stopped listening to bass',
    );
    expect(
      formatAudioReachSummary([
        'zoom stopped listening to bass',
        'warp stopped listening to mid',
      ]),
    ).toBe('zoom stopped listening to bass and warp stopped listening to mid');
  });
});
