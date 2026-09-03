import { afterEach, describe, expect, test } from 'bun:test';
import {
  getCapturedPresetStill,
  getPresetStillCacheSize,
  isPresetUnrenderable,
  MAX_CAPTURE_CACHE_SIZE,
  markPresetUnrenderable,
  rememberPresetStill,
  resetPresetStillCaptureState,
  setPresetStillEncoderForTests,
  subscribePresetStills,
} from '../../src/js/frontend/preset-still-capture.ts';

/** Stands in for a live tile's canvas. The real encoder reads a WebGL drawing
 * buffer, which the DOM test environment has no way to provide. */
function fakeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

afterEach(() => {
  setPresetStillEncoderForTests(null);
  resetPresetStillCaptureState();
});

describe('preset still capture', () => {
  test('keeps a frame read off a tile that was already rendering', () => {
    setPresetStillEncoderForTests(() => 'frame:alpha');

    expect(rememberPresetStill('alpha', fakeCanvas())).toBe('frame:alpha');
    expect(getCapturedPresetStill('alpha')).toBe('frame:alpha');
  });

  test('has no still for a preset nothing has rendered', () => {
    // The reason this module exists. The art slot used to fill this case with
    // a picture generated from a hash of the preset id, styled to sit in the
    // slot "exactly as a real thumbnail would" — a claim about a preset that
    // nothing had looked at. Absence has to be representable.
    expect(getCapturedPresetStill('never-seen')).toBeNull();
    expect(isPresetUnrenderable('never-seen')).toBe(false);
  });

  test('encodes once per preset however often a tile re-runs it', () => {
    let encodes = 0;
    setPresetStillEncoderForTests(() => {
      encodes += 1;
      return 'frame';
    });

    rememberPresetStill('repeat', fakeCanvas());
    rememberPresetStill('repeat', fakeCanvas());
    rememberPresetStill('repeat', fakeCanvas());

    expect(encodes).toBe(1);
  });

  test('an encoder that yields nothing stores nothing', () => {
    setPresetStillEncoderForTests(() => '');

    expect(rememberPresetStill('blank', fakeCanvas())).toBeNull();
    expect(getCapturedPresetStill('blank')).toBeNull();
  });

  test('a throwing encoder is a miss, not a crash', () => {
    setPresetStillEncoderForTests(() => {
      throw new Error('no drawing buffer');
    });

    expect(rememberPresetStill('explodes', fakeCanvas())).toBeNull();
    expect(getCapturedPresetStill('explodes')).toBeNull();
  });

  test('a failed engine settles the preset as unrenderable', () => {
    markPresetUnrenderable('broken');

    expect(isPresetUnrenderable('broken')).toBe(true);
    expect(getCapturedPresetStill('broken')).toBeNull();
  });

  test('a real frame overrides an earlier failure', () => {
    setPresetStillEncoderForTests(() => 'frame:recovered');
    markPresetUnrenderable('recovered');

    rememberPresetStill('recovered', fakeCanvas());

    expect(isPresetUnrenderable('recovered')).toBe(false);
    expect(getCapturedPresetStill('recovered')).toBe('frame:recovered');
  });

  test('notifies subscribers so a mounted tile can swap in the real frame', () => {
    setPresetStillEncoderForTests(() => 'frame:notify');
    const seen: string[] = [];
    const unsubscribe = subscribePresetStills((id) => seen.push(id));

    rememberPresetStill('notify', fakeCanvas());
    markPresetUnrenderable('other');
    unsubscribe();
    rememberPresetStill('after-unsubscribe', fakeCanvas());

    expect(seen).toEqual(['notify', 'other']);
  });

  test('bounds how many stills it retains', () => {
    setPresetStillEncoderForTests(() => 'x'.repeat(16));

    // Data URLs are large; this cache is exactly the "preview cache that only
    // ever grows" that check-cache-bounds.ts was written for.
    for (let i = 0; i < MAX_CAPTURE_CACHE_SIZE + 25; i++) {
      rememberPresetStill(`bulk-${i}`, fakeCanvas());
    }

    expect(getPresetStillCacheSize()).toBe(MAX_CAPTURE_CACHE_SIZE);
    // Oldest-first eviction.
    expect(getCapturedPresetStill('bulk-0')).toBeNull();
    expect(
      getCapturedPresetStill(`bulk-${MAX_CAPTURE_CACHE_SIZE + 24}`),
    ).not.toBeNull();
  });
});
