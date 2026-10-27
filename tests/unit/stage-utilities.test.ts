import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  BLACKOUT_LATCH_WINDOW_MS,
  handleBlackoutKeyDown,
  handleBlackoutKeyUp,
  handleFlashKeyDown,
  handleFlashKeyUp,
  releaseStageUtilities,
  resetStageUtilitiesForTests,
  type StageUtilityMode,
  stageUtilityMode,
  toggleBlackout,
} from '../../src/js/core/services/stage-utilities.ts';

const T0 = 1000;

beforeEach(() => {
  resetStageUtilitiesForTests();
});

afterEach(() => {
  resetStageUtilitiesForTests();
});

function modeAfterDown(offsetMs: number, repeat = false) {
  handleBlackoutKeyDown(repeat, T0 + offsetMs);
  return stageUtilityMode();
}

function modeAfterRelease(offsetMs: number) {
  handleBlackoutKeyUp(T0 + offsetMs);
  return stageUtilityMode();
}

describe('blackout hold', () => {
  test('a keydown cuts the stage and the keyup restores it', () => {
    expect(modeAfterDown(0)).toBe<StageUtilityMode>('blackout');
    expect(modeAfterRelease(200)).toBe<StageUtilityMode>('normal');
  });

  test('a long hold is momentary — release always wins', () => {
    handleBlackoutKeyDown(false, T0);
    expect(stageUtilityMode()).toBe('blackout');
    expect(modeAfterRelease(2500)).toBe('normal');
  });

  test('key auto-repeat is not a new press', () => {
    expect(modeAfterDown(0, true)).toBe<StageUtilityMode>('normal');
    handleBlackoutKeyDown(false, T0);
    // The repeats that arrive while the key is down must not restart the
    // double-tap logic: the press in progress has no release to measure from.
    handleBlackoutKeyDown(true, T0 + 50);
    handleBlackoutKeyDown(true, T0 + 100);
    expect(modeAfterRelease(150)).toBe('normal');
  });

  test('a stray keyup with nothing engaged does nothing', () => {
    handleBlackoutKeyUp(T0);
    expect(stageUtilityMode()).toBe('normal');
  });
});

describe('blackout double-tap latch', () => {
  test('two fast presses latch the cut through the keyups', () => {
    expect(modeAfterDown(0)).toBe<StageUtilityMode>('blackout');
    expect(modeAfterRelease(80)).toBe<StageUtilityMode>('normal');
    expect(modeAfterDown(160)).toBe<StageUtilityMode>('blackout');
    // This is the latch: the release does not restore the picture.
    expect(modeAfterRelease(240)).toBe<StageUtilityMode>('blackout');
  });

  test('one more press releases the latch', () => {
    modeAfterDown(0);
    modeAfterRelease(80);
    modeAfterDown(160);
    modeAfterRelease(240);
    expect(modeAfterDown(400)).toBe<StageUtilityMode>('normal');
  });

  test('a gap longer than the latch window keeps it a hold', () => {
    handleBlackoutKeyDown(false, T0);
    handleBlackoutKeyUp(T0 + 80);
    handleBlackoutKeyDown(false, T0 + 80 + BLACKOUT_LATCH_WINDOW_MS + 1);
    expect(modeAfterRelease(600)).toBe('normal');
  });

  test('the gap is measured from the release to the next press', () => {
    // A long hold that is followed by an immediate re-press is still a
    // double-tap: what separates a latch from a second hold is how fast the
    // next press follows, not how long the first one lasted.
    handleBlackoutKeyDown(false, T0);
    handleBlackoutKeyUp(T0 + 2000);
    handleBlackoutKeyDown(false, T0 + 2030);
    expect(modeAfterRelease(2060)).toBe('blackout');
  });

  test('a release after the latch does not clear it', () => {
    modeAfterDown(0);
    modeAfterRelease(80);
    modeAfterDown(160);
    modeAfterRelease(240);
    // Stray or repeated keyups must not unlatch; only a keydown does.
    handleBlackoutKeyUp(260);
    expect(stageUtilityMode()).toBe('blackout');
  });
});

describe('white flash', () => {
  test('a keydown flashes white and the keyup restores the picture', () => {
    handleFlashKeyDown(false);
    expect(stageUtilityMode()).toBe('flash');
    handleFlashKeyUp();
    expect(stageUtilityMode()).toBe('normal');
  });

  test('the flash never latches', () => {
    handleFlashKeyDown(false);
    handleFlashKeyUp();
    handleFlashKeyDown(false);
    handleFlashKeyUp();
    expect(stageUtilityMode()).toBe('normal');
  });

  test('key auto-repeat does not start a flash', () => {
    handleFlashKeyDown(true);
    expect(stageUtilityMode()).toBe('normal');
  });
});

describe('the two utilities share one stage', () => {
  test('a flash preempts a held blackout, and does not restore it', () => {
    handleBlackoutKeyDown(false, T0);
    handleFlashKeyDown(false);
    expect(stageUtilityMode()).toBe('flash');
    handleFlashKeyUp();
    // The blackout hold ended the moment its key was no longer the story;
    // restarting it is a new press, never a silent resume.
    expect(stageUtilityMode()).toBe('normal');
  });

  test('a blackout keyup does not end a flash', () => {
    handleFlashKeyDown(false);
    handleBlackoutKeyUp(T0 + 50);
    expect(stageUtilityMode()).toBe('flash');
  });
});

describe('releaseStageUtilities', () => {
  test('drops a latched cut without a keydown', () => {
    modeAfterDown(0);
    modeAfterRelease(80);
    modeAfterDown(160);
    modeAfterRelease(240);
    releaseStageUtilities();
    expect(stageUtilityMode()).toBe('normal');
  });

  test('is safe to call when nothing is engaged', () => {
    releaseStageUtilities();
    expect(stageUtilityMode()).toBe('normal');
  });
});

describe('blackout from a command', () => {
  test('latches, since no release follows, and the next run ends it', () => {
    toggleBlackout();
    expect(stageUtilityMode()).toBe<StageUtilityMode>('blackout');
    // A stray D keyup (a key let go from before) must not end it.
    handleBlackoutKeyUp(T0);
    expect(stageUtilityMode()).toBe<StageUtilityMode>('blackout');
    toggleBlackout();
    expect(stageUtilityMode()).toBe<StageUtilityMode>('normal');
  });

  test('one press of D ends it, as it ends a double-tap latch', () => {
    toggleBlackout();
    expect(modeAfterDown(0)).toBe<StageUtilityMode>('normal');
    expect(modeAfterRelease(100)).toBe<StageUtilityMode>('normal');
  });
});
