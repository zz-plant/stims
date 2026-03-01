import { describe, expect, mock, test } from 'bun:test';
import type { ToyEntry } from '../assets/js/data/toy-schema.ts';
import { createSessionTracking } from '../assets/js/loader/session-tracking.ts';

describe('session tracking', () => {
  test('tracks interactions and remembers recent toys', () => {
    const addEventListener = mock(() => {});
    const now = mock(() => 1000);
    const toys = [
      { slug: 'a', type: 'module' },
      { slug: 'b', type: 'module' },
      { slug: 'c', type: 'module' },
    ] as ToyEntry[];

    const tracking = createSessionTracking({
      toys,
      now,
      windowRef: () => ({ addEventListener }) as unknown as Window,
    });

    tracking.initInteractionTracking();
    expect(addEventListener).toHaveBeenCalledTimes(3);

    tracking.rememberToy('a');
    tracking.rememberToy('b');
    tracking.rememberToy('c');

    const originalRandom = Math.random;
    Math.random = () => 0;
    expect(tracking.pickNextToySlug('c')).toBe('a');
    Math.random = originalRandom;
  });
});
