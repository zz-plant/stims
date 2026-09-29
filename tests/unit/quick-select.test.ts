import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearQuickSelectEntries,
  getQuickSelectEntries,
  publishQuickSelectEntries,
  QUICK_SELECT_LIMIT,
  quickSelectDigit,
  subscribeQuickSelect,
} from '../../src/js/frontend/quick-select.ts';

afterEach(() => {
  clearQuickSelectEntries();
});

describe('quick-select store', () => {
  test('keeps only the first nine, in the order published', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `p${index}`);
    publishQuickSelectEntries(ids);

    expect(getQuickSelectEntries()).toEqual(ids.slice(0, QUICK_SELECT_LIMIT));
  });

  test('notifies only when the numbered list actually changes', () => {
    let notified = 0;
    const unsubscribe = subscribeQuickSelect(() => {
      notified += 1;
    });

    publishQuickSelectEntries(['a', 'b']);
    publishQuickSelectEntries(['a', 'b']);
    expect(notified).toBe(1);

    publishQuickSelectEntries(['b', 'a']);
    expect(notified).toBe(2);
    unsubscribe();
  });

  test('digits run 1–9 and stop', () => {
    expect(quickSelectDigit(0)).toBe('1');
    expect(quickSelectDigit(8)).toBe('9');
    expect(quickSelectDigit(9)).toBeNull();
    expect(quickSelectDigit(-1)).toBeNull();
  });
});
