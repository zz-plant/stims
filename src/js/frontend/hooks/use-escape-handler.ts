import { useEffect, useRef } from 'react';
import { registerEscapeHandler } from '../../core/modal-utils.ts';

/**
 * Claims Escape for an overlay while `active`, as the innermost one open.
 *
 * The registration order *is* the nesting order, so it must not change for
 * any reason other than an overlay opening or closing. Registering the
 * handler directly makes that fragile: `SidePanel` takes an inline
 * `onClose={() => ui.updatePanel(null)}`, a new function on every render of
 * the shell, which would re-run the effect and push the panel back on top of
 * the stack. The workspace provider re-renders every frame while audio plays,
 * so with the stage editor and the overflow menu open together, Escape would
 * start closing the editor underneath and leave the menu up.
 *
 * The handler is read through a ref and the effect depends only on `active`,
 * so a re-render cannot reorder the stack.
 */
export function useEscapeHandler(active: boolean, handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    return registerEscapeHandler(() => handlerRef.current());
  }, [active]);
}

/**
 * How many overlays currently hold the bottom of the screen.
 *
 * Refcounted rather than a boolean because these can overlap — the stage menu
 * can be open under a help dialog — and the last one to close must not clear
 * a signal the other still needs.
 */
let bottomOverlayCount = 0;

function setBottomOverlayAttribute() {
  const shell = document.getElementById('stims-main');
  if (!shell) return;
  if (bottomOverlayCount > 0) {
    shell.setAttribute('data-bottom-overlay', 'true');
  } else {
    shell.removeAttribute('data-bottom-overlay');
  }
}

/**
 * Announces that this overlay occupies the bottom of the screen while
 * `active`, so toasts move out of its way.
 *
 * Toasts sit above every overlay, which is only safe because they dodge
 * whatever holds the bottom. Sheets publish that as `data-sheet-open` from
 * the shell itself. The stage overflow menu is bottom-anchored, and on phones
 * the help dialogs are bottom sheets too, so they say so here.
 */
export function useBottomOverlaySignal(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    bottomOverlayCount += 1;
    setBottomOverlayAttribute();
    return () => {
      bottomOverlayCount = Math.max(0, bottomOverlayCount - 1);
      setBottomOverlayAttribute();
    };
  }, [active]);
}
