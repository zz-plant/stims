import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SidePanel } from '../../src/js/frontend/SidePanel.tsx';

/**
 * Dismissing a panel has to actually take it out of the document.
 *
 * SidePanel plays a 200ms exit animation, so it latches `exiting` and keeps
 * rendering until the animation is done. The latch was only ever cleared on
 * the way *in* (`if (open) setExiting(false)`), so once a panel had been
 * dismissed once, `open` was false and `exiting` was true forever, and the
 * `!open && !exiting` unmount guard never fired again.
 *
 * What was left behind is a `role="dialog" aria-modal="true"` shell holding a
 * Close button: Tab walked into a panel that was no longer there, Escape did
 * nothing (its handler is gated on `open`), focus was never handed back to
 * whatever opened the panel, and `aria-modal` hid the rest of the app from
 * assistive tech. Reopening the panel cleared the latch, which is why it
 * survived so much clicking around.
 */

const EXIT_ANIMATION_MS = 200;

function Harness({ openerLabel }: { openerLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {openerLabel}
      </button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Browse presets"
      >
        <button type="button">inside the panel</button>
      </SidePanel>
    </>
  );
}

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

const pressEscape = () =>
  act(() => {
    // happy-dom exposes its constructors on `window`, not on the module's
    // own global scope the way a browser does.
    const KeyboardEventCtor = window.KeyboardEvent ?? globalThis.KeyboardEvent;
    document.dispatchEvent(
      new KeyboardEventCtor('keydown', { key: 'Escape', bubbles: true }),
    );
  });

describe('SidePanel dismissal', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  const mount = () => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<Harness openerLabel="Open browse" />);
    });
    return host.querySelector('button') as HTMLButtonElement;
  };

  const panelInDocument = () =>
    document.querySelector('[data-shell-dialog="true"]');

  test('a dismissed panel leaves the document instead of latching open', async () => {
    const opener = mount();
    act(() => opener.click());
    expect(panelInDocument()).not.toBeNull();

    await pressEscape();
    await settle(EXIT_ANIMATION_MS + 80);

    expect(panelInDocument()).toBeNull();
  });

  test('a panel dismissed once can be reopened and dismissed again', async () => {
    const opener = mount();
    for (const round of [1, 2]) {
      act(() => opener.click());
      expect(panelInDocument(), `round ${round}: opened`).not.toBeNull();
      await pressEscape();
      await settle(EXIT_ANIMATION_MS + 80);
      expect(panelInDocument(), `round ${round}: dismissed`).toBeNull();
    }
  });

  test('dismissal hands focus back to whatever opened the panel', async () => {
    const opener = mount();
    opener.focus();
    act(() => opener.click());
    // The trap lands on the dialog itself, so focus is inside the panel — the
    // exact case the restore used to skip, because it treated "focus is in
    // some dialog" as "another dialog has taken over".
    expect(document.activeElement).toBe(panelInDocument() as Element);

    await pressEscape();
    await settle(EXIT_ANIMATION_MS + 80);

    expect(document.activeElement).toBe(opener);
  });

  test('closing from outside the panel unmounts it without an exit latch', async () => {
    // The route changing under an open panel (a shortcut toggling the same
    // panel off, a back navigation) flips `open` straight to false without
    // ever going through the panel's own timed close.
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const renderWith = (open: boolean) =>
      act(() => {
        root?.render(
          <SidePanel open={open} onClose={() => {}} title="Browse presets">
            <button type="button">inside the panel</button>
          </SidePanel>,
        );
      });

    renderWith(true);
    expect(panelInDocument()).not.toBeNull();

    renderWith(false);
    await settle(EXIT_ANIMATION_MS + 80);

    expect(panelInDocument()).toBeNull();
  });
});
