import { afterEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { registerEscapeHandler } from '../../src/js/core/modal-utils.ts';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from '../../src/js/frontend/hooks/use-escape-handler.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

/**
 * Escape registration order *is* overlay nesting order, so it must change only
 * when an overlay opens or closes.
 *
 * That is easy to get wrong. `SidePanel` takes an inline
 * `onClose={() => ui.updatePanel(null)}` — a new function on every render of
 * the shell — so registering the handler directly re-ran the effect and pushed
 * the panel back on top of the stack. The workspace provider re-renders every
 * frame while audio plays, so with the stage editor and the overflow menu open
 * together, Escape would drift to closing the editor underneath.
 */

function pressEscape() {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Escape' });
  document.dispatchEvent(event);
}

/** An overlay whose handler identity changes on every render, like the real one. */
function Overlay({
  name,
  calls,
  revision,
}: {
  name: string;
  calls: string[];
  revision: number;
}) {
  useEscapeHandler(true, () => calls.push(`${name}@${revision}`));
  return null;
}

function ReRenderingOverlay({ calls }: { calls: string[] }) {
  const [revision, setRevision] = useState(0);
  return (
    <div>
      <Overlay name="panel" calls={calls} revision={revision} />
      <button
        type="button"
        data-rerender="true"
        onClick={() => setRevision((value) => value + 1)}
      >
        re-render
      </button>
    </div>
  );
}

afterEach(() => {
  document.getElementById('stims-main')?.remove();
});

describe('useEscapeHandler', () => {
  test('a re-render does not move the panel above the overlay on top', () => {
    const calls: string[] = [];
    // The panel registers first, so it is the one underneath.
    const rendered = renderWorkspace(<ReRenderingOverlay calls={calls} />);
    // Then something opens over it. Registered directly, the way the stage
    // menu's own effect does: stable, and not re-run by the shell's renders.
    const releaseMenu = registerEscapeHandler(() => calls.push('menu'));

    try {
      pressEscape();
      expect(calls).toEqual(['menu']);

      // Re-render the panel with a fresh handler identity, which is what
      // every frame of audio playback does to the real side panel.
      rendered.click(rendered.container.querySelector('[data-rerender]'));
      pressEscape();

      // Still the menu. Re-registering on identity churn made this 'panel@1',
      // so Escape drifted to closing the panel underneath the open menu.
      expect(calls).toEqual(['menu', 'menu']);
    } finally {
      releaseMenu();
      rendered.dispose();
    }
  });

  test('the latest handler runs even though registration is stable', () => {
    const calls: string[] = [];
    function Single({ revision }: { revision: number }) {
      useEscapeHandler(true, () => calls.push(`only@${revision}`));
      return null;
    }
    function Harness() {
      const [revision, setRevision] = useState(0);
      return (
        <div>
          <Single revision={revision} />
          <button
            type="button"
            data-rerender="true"
            onClick={() => setRevision((value) => value + 1)}
          >
            re-render
          </button>
        </div>
      );
    }

    const rendered = renderWorkspace(<Harness />);
    try {
      rendered.click(rendered.container.querySelector('[data-rerender]'));
      pressEscape();

      // Stable registration must not mean a stale closure.
      expect(calls).toEqual(['only@1']);
    } finally {
      rendered.dispose();
    }
  });

  test('an inactive overlay claims nothing', () => {
    const calls: string[] = [];
    function Inactive() {
      useEscapeHandler(false, () => calls.push('inactive'));
      return null;
    }
    const rendered = renderWorkspace(<Inactive />);
    try {
      pressEscape();
      expect(calls).toEqual([]);
    } finally {
      rendered.dispose();
    }
  });
});

describe('useBottomOverlaySignal', () => {
  function shell() {
    let root = document.getElementById('stims-main');
    if (!root) {
      root = document.createElement('main');
      root.id = 'stims-main';
      document.body.appendChild(root);
    }
    return root;
  }

  function Signal({ active }: { active: boolean }) {
    useBottomOverlaySignal(active);
    return null;
  }

  test('marks the shell while a bottom overlay is open', () => {
    const root = shell();
    const rendered = renderWorkspace(<Signal active />);
    try {
      expect(root.getAttribute('data-bottom-overlay')).toBe('true');
    } finally {
      rendered.dispose();
    }
    expect(root.hasAttribute('data-bottom-overlay')).toBe(false);
  });

  test('two overlapping overlays keep the mark until both close', () => {
    const root = shell();
    // The stage menu can be open underneath a help dialog, so the first one to
    // close must not clear a signal the other still needs.
    const menu = renderWorkspace(<Signal active />);
    const dialog = renderWorkspace(<Signal active />);
    try {
      expect(root.getAttribute('data-bottom-overlay')).toBe('true');
      dialog.dispose();
      expect(root.getAttribute('data-bottom-overlay')).toBe('true');
    } finally {
      menu.dispose();
    }
    expect(root.hasAttribute('data-bottom-overlay')).toBe(false);
  });
});
