import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  dismissStageHint,
  isStageHintDismissed,
  resetStageHintCache,
  subscribeStageHints,
} from '../../src/js/frontend/stage-hint-cards.ts';

describe('stage hint cards', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStageHintCache();
  });

  afterEach(() => {
    localStorage.clear();
    resetStageHintCache();
  });

  test('each card starts undismissed and stays dismissed across a reload', () => {
    expect(isStageHintDismissed('perform')).toBeFalse();
    expect(isStageHintDismissed('cue')).toBeFalse();

    dismissStageHint('perform');
    expect(isStageHintDismissed('perform')).toBeTrue();
    expect(isStageHintDismissed('cue')).toBeFalse();

    // Under the key the card always used, so nobody's old dismissal is lost.
    expect(localStorage.getItem('stims:perform-empty-hint-dismissed')).toBe(
      '1',
    );
    resetStageHintCache();
    expect(isStageHintDismissed('perform')).toBeTrue();
  });

  test('dismissing one card notifies the other, once', () => {
    // The cue deck waits behind the Perform card, so it has to hear about
    // that card going — without re-rendering for a repeat dismissal.
    let notified = 0;
    const unsubscribe = subscribeStageHints(() => {
      notified += 1;
    });

    dismissStageHint('perform');
    dismissStageHint('perform');
    expect(notified).toBe(1);

    unsubscribe();
    dismissStageHint('cue');
    expect(notified).toBe(1);
  });
});
