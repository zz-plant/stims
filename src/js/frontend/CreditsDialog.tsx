import type { RefObject } from 'react';
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
  });

  if (!open) return null;

  return (
    <div
      className="stims-shell__credits-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="About Stims and credits"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
      <div
        ref={creditsRef}
        className="stims-shell__credits-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Let Escape bubble to the backdrop's close handler above — focus
          // is trapped inside this card for the entire time it's open, so
          // an unconditional stopPropagation here would make Escape a dead
          // key while the dialog is up.
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
        role="presentation"
      >
        <CreditsPanel />
        <button
          type="button"
          className="cta-button ghost"
          onClick={onClose}
          style={{ marginTop: '1.5rem' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
