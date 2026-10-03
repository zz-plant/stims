/**
 * The quality score's static audio component, read from a preset's
 * equations: full credit when the audio drives what it draws, half when only
 * its waveform shows the audio, none when audio names appear only in code
 * that reaches nothing drawn.
 */
import { describe, expect, test } from 'bun:test';
import { staticAudioScore } from '../../scripts/score-catalog-quality.ts';

const preset = (lines: string[]) => `[preset00]\n${lines.join('\n')}\n`;

describe('staticAudioScore', () => {
  test.each(['percussive', 'harmonic', 'percussive_ratio', 'percussiveHigh'])(
    'HPSS input %s driving motion earns full credit',
    (signal) => {
      expect(
        staticAudioScore(
          `hpss-${signal}`,
          preset(['wave_a=0', `per_frame_1=zoom = 1 + 0.1*${signal};`]),
        ),
      ).toBe(1);
    },
  );

  test('overwritten HPSS input earns no audio credit', () => {
    expect(
      staticAudioScore(
        'hpss-overwritten',
        preset([
          'wave_a=0',
          'per_frame_1=zoom = 1 + 0.1*harmonic;',
          'per_frame_2=zoom = 1;',
        ]),
      ),
    ).toBe(0);
  });

  test('audio driving the motion earns full credit', () => {
    expect(
      staticAudioScore(
        'a',
        preset(['wave_a=0', 'per_frame_1=zoom = 1 + 0.1*bass;']),
      ),
    ).toBe(1);
  });

  test('a visible waveform alone earns half', () => {
    expect(
      staticAudioScore(
        'b',
        preset(['wave_a=0.8', 'per_frame_1=rot = 0.01*sin(time);']),
      ),
    ).toBe(0.5);
  });

  test('an audio name in overwritten code earns nothing', () => {
    // a text search for "bass" credited this preset in full
    expect(
      staticAudioScore(
        'c',
        preset([
          'wave_a=0',
          'per_frame_1=q1 = bass;',
          'per_frame_2=q1 = 0.4*time;',
        ]),
      ),
    ).toBe(0);
  });
});
