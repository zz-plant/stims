import { describe, expect, it } from 'bun:test';
import {
  COLOR_GROUPS,
  CONTROL_SECTIONS,
  channelsToHex,
  ENUM_CONTROLS,
  formatControlValue,
  hexToChannels,
  positionToValue,
  RANGE_CONTROLS,
  retentionToSeconds,
  SCALAR_CONTROLS,
  secondsToRetention,
  TOGGLE_CONTROLS,
  valueToPosition,
} from '../../src/js/milkdrop/preset-controls.ts';

/**
 * The point of the scale kinds is that equal travel means something equal.
 * On the old linear tracks, `zoom` spent three quarters of its range on
 * "bigger" and `decay` put everything useful in the last 2%.
 */
describe('control scales', () => {
  const zoom = SCALAR_CONTROLS.find((c) => c.key === 'zoom');
  if (!zoom) throw new Error('zoom control missing');

  describe('ratio', () => {
    it('puts the neutral value dead centre', () => {
      expect(valueToPosition(1, zoom)).toBeCloseTo(0.5, 6);
    });

    it('is log-uniform within a half: equal ratios, equal travel', () => {
      // sqrt(3) is the geometric midpoint of 1..3, so it should land halfway
      // along the upper half of the track. On a linear track it lands at 36%.
      const mid = valueToPosition(Math.sqrt(3), zoom);
      expect(mid).toBeCloseTo(0.75, 6);

      // Same property below neutral, over 0.2..1.
      expect(valueToPosition(Math.sqrt(0.2), zoom)).toBeCloseTo(0.25, 6);
    });

    it('costs the same travel for the same proportional change', () => {
      // The actual win over a linear track. A +5% nudge is one gesture
      // wherever you are, instead of a hair's width down low and a shove up
      // high — on the old linear track those two differed by about 7x.
      const step = (from: number) =>
        valueToPosition(from * 1.05, zoom) - valueToPosition(from, zoom);
      expect(step(1.0)).toBeCloseTo(step(2.0), 6);

      const linearStep = (from: number) =>
        (from * 0.05) / (zoom.max - zoom.min);
      expect(linearStep(2.0) / linearStep(0.3)).toBeGreaterThan(6);
    });

    it('trades equal-ratio-everywhere for a findable neutral', () => {
      // Pinning 1.0 to the centre when the bounds are asymmetric (0.2..1 is a
      // 5x range, 1..3 is 3x) necessarily gives the two halves different
      // ratio-per-pixel. That is the deliberate trade: neutral is worth more
      // than uniformity across the whole track.
      const below = 0.5 - valueToPosition(0.5, zoom);
      const above = valueToPosition(2, zoom) - 0.5;
      expect(below).toBeGreaterThan(0);
      expect(above).toBeGreaterThan(0);
      expect(below).not.toBeCloseTo(above, 2);
    });

    it('round-trips value → position → value', () => {
      for (const value of [0.25, 0.5, 1, 1.5, 2.4]) {
        expect(positionToValue(valueToPosition(value, zoom), zoom)).toBeCloseTo(
          value,
          6,
        );
      }
    });

    it('reaches both ends of the track exactly', () => {
      expect(valueToPosition(zoom.min, zoom)).toBeCloseTo(0, 6);
      expect(valueToPosition(zoom.max, zoom)).toBeCloseTo(1, 6);
    });
  });

  describe('retention', () => {
    it('converts a decay factor to a trail length', () => {
      // 0.98^n = 0.5 at n≈34 frames, ≈0.57s at 60fps.
      expect(retentionToSeconds(0.98)).toBeCloseTo(0.572, 2);
      expect(retentionToSeconds(0.9)).toBeLessThan(retentionToSeconds(0.99));
    });

    it('round-trips seconds → decay → seconds', () => {
      for (const seconds of [0.1, 0.5, 2, 8]) {
        expect(retentionToSeconds(secondsToRetention(seconds))).toBeCloseTo(
          seconds,
          3,
        );
      }
    });

    it('spreads the useful range across the whole track', () => {
      const decay = SCALAR_CONTROLS.find((c) => c.key === 'decay');
      if (!decay) throw new Error('decay control missing');

      // On a linear 0.8..1.0 track, 0.98 sits at 90% — every interesting
      // value crammed into the last sliver. Here it is nearer the middle.
      const linear = (0.98 - decay.min) / (decay.max - decay.min);
      const scaled = valueToPosition(0.98, decay);
      expect(linear).toBeGreaterThan(0.85);
      expect(scaled).toBeLessThan(0.6);
      expect(scaled).toBeGreaterThan(0.2);
    });

    it('round-trips through the track position', () => {
      const decay = SCALAR_CONTROLS.find((c) => c.key === 'decay');
      if (!decay) throw new Error('decay control missing');
      for (const value of [0.85, 0.95, 0.98, 0.995]) {
        expect(
          positionToValue(valueToPosition(value, decay), decay),
        ).toBeCloseTo(value, 4);
      }
    });
  });

  describe('linear', () => {
    it('maps straight through', () => {
      const rot = SCALAR_CONTROLS.find((c) => c.key === 'rot');
      if (!rot) throw new Error('rot control missing');
      expect(valueToPosition(0, rot)).toBeCloseTo(0.5, 6);
      expect(positionToValue(0.75, rot)).toBeCloseTo(0.5, 6);
    });
  });

  describe('formatControlValue', () => {
    it('labels ratios as multipliers and retention as a tail', () => {
      expect(formatControlValue(1.35, { scale: 'ratio' })).toBe('1.35×');
      expect(formatControlValue(0.98, { scale: 'retention' })).toContain(
        'tail',
      );
      expect(formatControlValue(0.25, { scale: 'linear' })).toBe('0.25');
    });
  });
});

describe('control catalogue', () => {
  it('covers the boolean fields the format stores as 0/1 floats', () => {
    const keys = TOGGLE_CONTROLS.map((t) => t.key);
    for (const key of [
      'brighten',
      'darken',
      'solarize',
      'invert',
      'darken_center',
      'red_blue_stereo',
      'texture_wrap',
      'video_echo_enabled',
      'motion_vectors',
      'wave_additive',
      'wave_usedots',
      'wave_thick',
      'wave_brighten',
      'bmodwavealphabyvolume',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('lists the post-processing toggles in pipeline order', () => {
    const post = TOGGLE_CONTROLS.filter((t) => t.section === 'post').map(
      (t) => t.key,
    );
    expect(post.indexOf('brighten')).toBeLessThan(post.indexOf('invert'));
    expect(post.indexOf('invert')).toBeLessThan(
      post.indexOf('video_echo_enabled'),
    );
  });

  it('gives wave_mode all eight of its modes', () => {
    const waveMode = ENUM_CONTROLS.find((e) => e.key === 'wave_mode');
    expect(waveMode?.options).toHaveLength(8);
    expect(waveMode?.options.map((o) => o.value)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('pairs each range control with both of its fields', () => {
    for (const range of RANGE_CONTROLS) {
      expect(range.minKey).not.toBe(range.maxKey);
      expect(range.defaultMin).toBeLessThanOrEqual(range.defaultMax);
    }
    const keys = RANGE_CONTROLS.flatMap((r) => [r.minKey, r.maxKey]);
    expect(keys).toContain('blur1_min');
    expect(keys).toContain('blur3_max');
    expect(keys).toContain('modwavealphastart');
  });

  it('never gives two controls the same field', () => {
    // Two controls writing one field fight each other on every doc echo.
    const owned = [
      ...SCALAR_CONTROLS.map((c) => c.key),
      ...TOGGLE_CONTROLS.map((c) => c.key),
      ...ENUM_CONTROLS.map((c) => c.key),
      ...RANGE_CONTROLS.flatMap((c) => [c.minKey, c.maxKey]),
      ...COLOR_GROUPS.flatMap((g) => [
        ...g.rgb,
        ...(g.alpha ? [g.alpha.key] : []),
      ]),
    ];
    expect(new Set(owned).size).toBe(owned.length);
  });
});

describe('colour channel conversion', () => {
  it('round-trips a hex colour', () => {
    expect(channelsToHex(hexToChannels('#3366ff'))).toBe('#3366ff');
  });

  it('clamps overdriven channels for display without inventing a value', () => {
    // Presets do push channels past 1; the swatch has to show something, but
    // the buffer keeps the original until the swatch is actually moved.
    expect(channelsToHex([1.8, 0, 0])).toBe('#ff0000');
  });
});

/**
 * The pane is grouped by what a field does, not by which widget it renders
 * as. Grouping by widget split the main wave across four separate places —
 * mode under Modes, colour under Colour, its four flags under Switches, its
 * volume fade-in under Ranges — which is a taxonomy of controls rather than
 * of the thing being edited.
 */
describe('control sections', () => {
  const sectionIds = CONTROL_SECTIONS.map((s) => s.id);

  it('assigns every control to a declared section', () => {
    const sections = [
      ...SCALAR_CONTROLS.map((c) => c.section),
      ...TOGGLE_CONTROLS.map((c) => c.section),
      ...ENUM_CONTROLS.map((c) => c.section),
      ...RANGE_CONTROLS.map((c) => c.section),
      ...COLOR_GROUPS.map((c) => c.section),
    ];
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(sectionIds).toContain(section);
    }
  });

  it('leaves no section empty', () => {
    for (const id of sectionIds) {
      const members = [
        ...SCALAR_CONTROLS.filter((c) => c.section === id),
        ...TOGGLE_CONTROLS.filter((c) => c.section === id),
        ...ENUM_CONTROLS.filter((c) => c.section === id),
        ...RANGE_CONTROLS.filter((c) => c.section === id),
        ...COLOR_GROUPS.filter((c) => c.section === id),
      ];
      expect(members.length).toBeGreaterThan(0);
    }
  });

  it('keeps everything about the main wave in one section', () => {
    // The regression this regrouping exists to prevent.
    expect(ENUM_CONTROLS.find((c) => c.key === 'wave_mode')?.section).toBe(
      'wave',
    );
    expect(COLOR_GROUPS.find((c) => c.label === 'Wave')?.section).toBe('wave');
    expect(
      RANGE_CONTROLS.find((c) => c.minKey === 'modwavealphastart')?.section,
    ).toBe('wave');
    for (const key of [
      'wave_additive',
      'wave_usedots',
      'wave_thick',
      'wave_brighten',
      'bmodwavealphabyvolume',
    ]) {
      expect(TOGGLE_CONTROLS.find((c) => c.key === key)?.section).toBe('wave');
    }
  });

  it('keeps the post chain with the scalars and ranges it drives', () => {
    // The echo toggle, its zoom/alpha and its orientation are one effect.
    for (const key of [
      'video_echo_enabled',
      'video_echo_zoom',
      'video_echo_alpha',
      'video_echo_orientation',
      'gammaadj',
    ]) {
      const section =
        SCALAR_CONTROLS.find((c) => c.key === key)?.section ??
        TOGGLE_CONTROLS.find((c) => c.key === key)?.section ??
        ENUM_CONTROLS.find((c) => c.key === key)?.section;
      expect(section).toBe('post');
    }
    expect(
      RANGE_CONTROLS.filter((c) => c.minKey.startsWith('blur')).every(
        (c) => c.section === 'post',
      ),
    ).toBe(true);
  });

  it('keeps the warp transform together', () => {
    for (const key of [
      'zoom',
      'warp',
      'rot',
      'cx',
      'cy',
      'sx',
      'sy',
      'dx',
      'dy',
    ]) {
      expect(SCALAR_CONTROLS.find((c) => c.key === key)?.section).toBe('warp');
    }
  });
});
