import { describe, expect, test } from 'bun:test';
import {
  ARM_TIMEOUT_MS,
  createCompassMorph,
  FADE_SPAN,
  RELEASE_RAMP_MS,
} from '../../src/js/frontend/compass-morph.ts';

/**
 * A fake engine with the runtime's manual-crossfade semantics: a switch
 * after arming starts a fade at 0, positions clamp, and a fade at 1 settles
 * on the next frame.
 */
function rig({ startsLive = true } = {}) {
  let clock = 0;
  let manual: number | null = null;
  let active = 'a';
  const calls: string[] = [];
  const morph = createCompassMorph({
    startFade: (id) => {
      calls.push(`fade:${id}`);
      active = id;
      if (startsLive) manual = 0;
    },
    setPosition: (position) => {
      if (manual !== null) manual = position;
    },
    getPosition: () => manual,
    select: (id) => {
      calls.push(`select:${id}`);
      active = id;
    },
    now: () => clock,
  });
  return {
    morph,
    calls,
    engine: {
      get position() {
        return manual;
      },
      get active() {
        return active;
      },
      goLive() {
        manual = 0;
      },
      frame() {
        if (manual !== null && manual >= 1) manual = null;
      },
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('compass morph', () => {
  test('moving inside the stage preset cell starts no fade', () => {
    const { morph, calls } = rig();
    morph.begin('a');
    morph.update('a', 0, 0);
    morph.update('a', 0.3, 0);
    expect(calls).toEqual([]);
    expect(morph.isBusy()).toBe(false);
  });

  test('entering another cell arms a fade at 0, and travel drives it', () => {
    const { morph, engine, calls } = rig();
    morph.begin('a');
    morph.update('b', 0.1, 0);
    expect(calls).toEqual(['fade:b']);
    expect(engine.position).toBe(0);
    morph.tick();
    morph.update('c', 0.1 + FADE_SPAN / 2, 0);
    expect(engine.position).toBeCloseTo(0.5, 5);
    morph.update('d', 0.1 + FADE_SPAN, 0);
    expect(engine.position).toBe(1);
    // The cells crossed mid-fade do not retarget it.
    expect(calls).toEqual(['fade:b']);
  });

  test('the fade only moves forward when the puck comes back', () => {
    const { morph, engine } = rig();
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.tick();
    morph.update('b', FADE_SPAN / 2, 0);
    morph.update('b', FADE_SPAN / 4, 0);
    expect(engine.position).toBeCloseTo(0.5, 5);
  });

  test('a completed fade lets the next cell arm the next fade', () => {
    const { morph, engine, calls } = rig();
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.tick();
    morph.update('b', FADE_SPAN, 0);
    engine.frame();
    morph.tick();
    expect(morph.stagePresetId()).toBe('b');
    morph.update('c', FADE_SPAN + 0.01, 0);
    expect(calls).toEqual(['fade:b', 'fade:c']);
  });

  test('release ramps an unfinished fade to the end within the ramp time', () => {
    const { morph, engine, advance } = rig();
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.tick();
    morph.update('b', FADE_SPAN / 2, 0);
    morph.release('b');
    advance(RELEASE_RAMP_MS * 0.25);
    morph.tick();
    expect(engine.position).toBeCloseTo(0.75, 5);
    advance(RELEASE_RAMP_MS * 0.25);
    morph.tick();
    expect(engine.position).toBe(1);
    engine.frame();
    morph.tick();
    expect(morph.isBusy()).toBe(false);
    expect(morph.stagePresetId()).toBe('b');
  });

  test('release over another preset plays it once the fade completes', () => {
    const { morph, engine, advance, calls } = rig();
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.tick();
    morph.release('a');
    expect(calls).toEqual(['fade:b']);
    advance(RELEASE_RAMP_MS);
    morph.tick();
    engine.frame();
    morph.tick();
    expect(calls).toEqual(['fade:b', 'select:a']);
    expect(engine.active).toBe('a');
    expect(morph.isBusy()).toBe(false);
  });

  test('a release with no fade plays the preset under the puck', () => {
    const { morph, calls } = rig();
    morph.begin('a');
    morph.release('a');
    expect(calls).toEqual([]);
    morph.begin('a');
    morph.release('far');
    expect(calls).toEqual(['select:far']);
  });

  test('a fade the engine never starts lets go after the arm timeout', () => {
    const { morph, advance } = rig({ startsLive: false });
    morph.begin('a');
    morph.update('b', 0, 0);
    expect(morph.isBusy()).toBe(true);
    advance(ARM_TIMEOUT_MS + 1);
    morph.tick();
    expect(morph.isBusy()).toBe(false);
    expect(morph.stagePresetId()).toBe('b');
  });

  test('a late start is caught up to the position already reached', () => {
    const { morph, engine } = rig({ startsLive: false });
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.update('b', FADE_SPAN / 2, 0);
    expect(engine.position).toBeNull();
    engine.goLive();
    morph.tick();
    expect(engine.position).toBeCloseTo(0.5, 5);
  });

  test('finish completes a live fade so none is left half-way', () => {
    const { morph, engine } = rig();
    morph.begin('a');
    morph.update('b', 0, 0);
    morph.finish();
    expect(engine.position).toBe(1);
    expect(morph.isBusy()).toBe(false);
  });
});
