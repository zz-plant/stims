import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { usePersistentPresetQueue } from '../../src/js/frontend/preset-queue.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

const STORAGE_KEY = 'stims:preset-queue:v1';

/**
 * `popNext` has to return the preset it removed, because "Take" loads that
 * preset and announces it.
 *
 * It used to read its own return value out of a `setPresetIds` updater. React
 * only runs an updater during dispatch on the eager-state path, which needs
 * the owning fiber to have no pending lanes — and the queue lives in the
 * workspace provider, which re-renders every frame while audio plays, i.e.
 * exactly when the cue deck is on screen. So the updater was deferred,
 * `popNext()` returned null while still queueing the removal, and Take
 * dropped the cued preset and reported "Nothing is cued".
 *
 * The tests below stage that by dirtying the fiber first: another queue
 * update in the same handler leaves a pending lane, which is what closes the
 * eager path.
 */

function Probe({
  dirtyFirst,
  popTwice = false,
}: {
  dirtyFirst: boolean;
  popTwice?: boolean;
}) {
  const queue = usePersistentPresetQueue([]);
  const [taken, setTaken] = useState<string>('none');

  return (
    <div>
      <button
        type="button"
        data-take="true"
        onClick={() => {
          // A pending update on this fiber before the pop is what the real
          // provider always has while audio is playing.
          if (dirtyFirst) queue.add('dirty-entry');
          const first = queue.popNext();
          const second = popTwice ? queue.popNext() : null;
          setTaken(popTwice ? `${first},${second}` : String(first));
        }}
      >
        take
      </button>
      <span data-taken="true">{taken}</span>
      <span data-remaining="true">{queue.presetIds.join('|')}</span>
    </div>
  );
}

function readText(container: HTMLElement, attribute: string) {
  return container.querySelector(`[${attribute}]`)?.textContent ?? '';
}

beforeEach(() => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ presetIds: ['alpha', 'beta', 'gamma'] }),
  );
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe('preset queue popNext', () => {
  test('returns the head even with an update already pending', () => {
    const rendered = renderWorkspace(<Probe dirtyFirst />);
    try {
      rendered.click(rendered.container.querySelector('[data-take]'));

      // The defect returned 'null' here while still removing the entry.
      expect(readText(rendered.container, 'data-taken')).toBe('alpha');
      expect(readText(rendered.container, 'data-remaining')).toBe(
        'beta|gamma|dirty-entry',
      );
    } finally {
      rendered.dispose();
    }
  });

  test('returns the head on a clean fiber too', () => {
    const rendered = renderWorkspace(<Probe dirtyFirst={false} />);
    try {
      rendered.click(rendered.container.querySelector('[data-take]'));

      expect(readText(rendered.container, 'data-taken')).toBe('alpha');
      expect(readText(rendered.container, 'data-remaining')).toBe('beta|gamma');
    } finally {
      rendered.dispose();
    }
  });

  test('removes exactly one entry when popped twice in one handler', () => {
    const rendered = renderWorkspace(<Probe dirtyFirst={false} popTwice />);
    try {
      rendered.click(rendered.container.querySelector('[data-take]'));

      // Both calls see the same rendered head, so the second is a repeat
      // rather than a second removal. Returning the same id twice is
      // recoverable; removing two presets while naming one is not.
      expect(readText(rendered.container, 'data-taken')).toBe('alpha,alpha');
      expect(readText(rendered.container, 'data-remaining')).toBe('beta|gamma');
    } finally {
      rendered.dispose();
    }
  });

  test('an empty queue yields null and stays empty', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetIds: [] }));
    const rendered = renderWorkspace(<Probe dirtyFirst={false} />);
    try {
      rendered.click(rendered.container.querySelector('[data-take]'));

      expect(readText(rendered.container, 'data-taken')).toBe('null');
      expect(readText(rendered.container, 'data-remaining')).toBe('');
    } finally {
      rendered.dispose();
    }
  });
});
