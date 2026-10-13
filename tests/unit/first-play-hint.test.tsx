import { describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ContextualHelp,
  useHelpHints,
} from '../../src/js/frontend/ContextualHelp.tsx';

/**
 * The first-play hint is the only teaching moment a visitor gets while the
 * dock is folded into the "Controls" pill (docs/PRODUCT_MOMENTS.md,
 * "Open one up"): it names the keys that reach everything else. Rendered
 * here rather than grepped from source, so the copy the stage actually
 * shows is what is under test.
 */

/** Triggers the first-play hint and renders both hint slots. */
function HintProbe() {
  const { visibleHint, showHint } = useHelpHints();
  return (
    <>
      <button type="button" onClick={() => showHint('first-play')}>
        Trigger the hint
      </button>
      <ContextualHelp hint={visibleHint} anchor="stage" />
      <ContextualHelp hint={visibleHint} anchor="panel" />
    </>
  );
}

describe('the first-play hint', () => {
  test('names the key into the editor alongside the other two routes', () => {
    localStorage.removeItem('stims:seen-hints');
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(createElement(HintProbe));
      });
      const trigger = container.querySelector<HTMLButtonElement>('button');
      expect(trigger).not.toBeNull();

      act(() => {
        trigger?.click();
      });

      // The desktop message: another visual, the way into the code, and the
      // key that lists every other one — each by name. (CSS-module class
      // names are empty under the test bundler, so the toast is found by the
      // roles and state it publishes.)
      const toast = container.querySelector('[role="status"]');
      expect(toast?.getAttribute('data-anchor')).toBe('stage');
      const message = toast?.textContent ?? '';
      expect(message).toContain('→');
      expect(message).toContain('E to edit its code');
      expect(message).toContain('?');

      // A stage hint does not also render over the panel slot.
      expect(container.querySelectorAll('[role="status"]').length).toBe(1);
    } finally {
      act(() => root.unmount());
      container.remove();
      localStorage.removeItem('stims:seen-hints');
    }
  });
});
