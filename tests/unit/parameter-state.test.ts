import { describe, expect, test } from 'bun:test';
import {
  describeParameterState,
  parameterStateLabel,
} from '../../src/js/frontend/parameter-state.ts';

/**
 * A preset whose per_frame block recomputes `zoom` every frame with an
 * equation the Tune faders did not author. The distinction matters: the
 * `base + depth*source` shape IS the Tune feature and must not be reported as
 * a conflict, so a fixture for the conflict case has to be visibly custom.
 */
const SHADOWING_PRESET = [
  '[preset00]',
  'zoom=1.020',
  'rot=0.000',
  'per_frame_1=zoom = 1.01 + 0.02*sin(time*3);',
].join('\n');

/** Same preset with `zoom` left as a plain literal. */
const PLAIN_PRESET = ['[preset00]', 'zoom=1.020', 'rot=0.000'].join('\n');

/** A Tune-fader modulation, in the exact shape preset-modulation writes. */
const TUNED_PRESET = [
  '[preset00]',
  'zoom=1.020',
  'per_frame_1=zoom = 1.02 + 0.15*bass_att;',
].join('\n');

describe('describeParameterState', () => {
  test('reports a plain field as manual, with its literal', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: PLAIN_PRESET,
    });

    expect(state.driver).toBe('manual');
    expect(state.overridden).toBe(false);
    expect(state.literal).toBeCloseTo(1.02, 5);
  });

  test('reports an unbound shadowed field as preset-driven, not overridden', () => {
    // Nothing is competing with the preset here, so there is no conflict to
    // warn about — this is just how the preset works.
    const state = describeParameterState({
      target: 'zoom',
      source: SHADOWING_PRESET,
    });

    expect(state.driver).toBe('preset-equation');
    expect(state.overridden).toBe(false);
  });

  test('flags a MIDI binding the preset overwrites', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: SHADOWING_PRESET,
      midiBound: true,
    });

    expect(state.driver).toBe('midi');
    expect(state.overridden).toBe(true);
    expect(state.summary).toContain('no effect');
  });

  test('flags a runtime modulator the preset overwrites — the case nothing reported before', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: SHADOWING_PRESET,
      runtimeModulated: true,
    });

    expect(state.driver).toBe('runtime-modulation');
    expect(state.overridden).toBe(true);
    expect(parameterStateLabel(state)).toBe('overridden');
  });

  test('a live runtime modulator on an unshadowed field is not flagged', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: PLAIN_PRESET,
      runtimeModulated: true,
    });

    expect(state.driver).toBe('runtime-modulation');
    expect(state.overridden).toBe(false);
  });

  test('a Tune-written modulation is the feature working, not a conflict', () => {
    // This equation shadows `zoom` by construction. Reporting it as an
    // override would flag every successful use of the Tune faders.
    const state = describeParameterState({
      target: 'zoom',
      source: TUNED_PRESET,
    });

    expect(state.driver).toBe('preset-modulation');
    expect(state.overridden).toBe(false);
    expect(parameterStateLabel(state)).toBe('tuned');
  });

  test('runtime modulation outranks a MIDI binding on the same target', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: PLAIN_PRESET,
      midiBound: true,
      runtimeModulated: true,
    });

    expect(state.driver).toBe('runtime-modulation');
  });

  test('reports the binding without guessing when no preset is loaded', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: null,
      midiBound: true,
    });

    expect(state.driver).toBe('midi');
    expect(state.overridden).toBe(false);
    expect(state.literal).toBeNull();
  });
});

describe('describeParameterState — user-facing controls', () => {
  test('a fader offered for a shadowed field reports as overridden', () => {
    // The performance surface pins faders. Without `userControlled` this read
    // as plain preset behaviour, and the fader moved with no effect and no
    // explanation — the exact failure this vocabulary exists to name.
    const state = describeParameterState({
      target: 'zoom',
      source: SHADOWING_PRESET,
      userControlled: true,
    });

    expect(state.overridden).toBe(true);
    expect(state.summary).toContain('no effect');
  });

  test('a fader on an unshadowed field is plain manual control', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: PLAIN_PRESET,
      userControlled: true,
    });

    expect(state.driver).toBe('manual');
    expect(state.overridden).toBe(false);
  });

  test('a real binding still outranks the bare presence of a fader', () => {
    const state = describeParameterState({
      target: 'zoom',
      source: SHADOWING_PRESET,
      midiBound: true,
      userControlled: true,
    });

    expect(state.driver).toBe('midi');
    expect(state.overridden).toBe(true);
  });
});
