import type { RefObject } from 'react';
import { useEffect } from 'react';
import { registerEscapeHandler } from '../core/modal-utils.ts';
import { CreditsPanel } from './CreditsPanel.tsx';
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
  useEffect(() => {
    if (!open) return;
    return registerEscapeHandler(onClose);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // The backdrop is the pointer affordance for dismiss. Its keyboard
    // equivalents are Escape, dispatched to the innermost overlay by
    // registerEscapeHandler above, and the Close button inside the card. A
    // keydown handler here would be dead code: focus is trapped in the card,
    // so the backdrop never receives one.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss is Escape, handled above
    <div
      className="stims-shell__credits-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="About Stims and credits"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
      <div
        ref={creditsRef}
        className="stims-shell__credits-card"
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
        role="presentation"
      >
        <CreditsPanel />
        <button type="button" className="cta-button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
