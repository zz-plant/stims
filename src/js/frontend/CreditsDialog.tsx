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
          e.stopPropagation();
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
