import type { RefObject } from 'react';
import { CreditsPanel } from './CreditsPanel.tsx';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';

export function CreditsDialog({
  open,
  onClose,
  creditsRef,
}: {
  open: boolean;
  onClose: () => void;
  creditsRef: RefObject<HTMLDivElement | null>;
}) {
  useFocusTrap({
    active: open,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: creditsRef,
    // Land on the dialog itself rather than the first control inside it, as
    // SidePanel does. Focusing a control scrolled the card to it, so the sheet
    // opened part-way down with its own heading already scrolled off — and a
    // screen reader announced that control instead of the dialog's name.
    initialFocus: 'container',
  });

  // See ShortcutsDialog: Escape is dispatched to the innermost overlay by the
  // shared stack, so it cannot reach a sheet underneath this dialog.
  useEscapeHandler(open, onClose);
  useBottomOverlaySignal(open);

  if (!open) return null;

  return (
    // The backdrop is the pointer affordance for dismiss. Its keyboard
    // equivalents are Escape, dispatched to the innermost overlay by
    // registerEscapeHandler above, and the Close button inside the card. A
    // keydown handler here would be dead code: focus is trapped in the card,
    // so the backdrop never receives one.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss is Escape, handled above
    // biome-ignore lint/a11y/noStaticElementInteractions: click-to-dismiss scrim; the dialog role belongs on the card it wraps
    <div className="stims-shell__credits-overlay" onClick={onClose}>
      <div
        ref={creditsRef}
        className="stims-shell__credits-card"
        // The dialog is the card, not the backdrop around it: the card is
        // what the focus trap fences, what takes initial focus, and what
        // `aria-modal` should be scoping.
        //
        // With the role on the backdrop and `role="presentation"` here, the
        // element the trap focused carried a role ARIA ignores on anything
        // focusable. So the dialog's own name was never announced; a screen
        // reader fell back to naming the focused element from its contents,
        // and read the card's entire text as one run-on label.
        role="dialog"
        aria-modal="true"
        aria-label="About Stims and credits"
        // Focusable only as a landing spot for the trap's initial focus, so
        // the sheet opens at its heading rather than scrolled to a control.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Escape is deliberately let through to the document listener that
          // closes the innermost overlay; everything else is contained so it
          // cannot reach the global shortcut handler.
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
      >
        <CreditsPanel />
        <button type="button" className="cta-button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
