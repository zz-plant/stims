import type { RefObject } from 'react';
import { useEffect } from 'react';

export function ShortcutsDialog({
  open,
  onClose,
  shortcutsRef,
}: {
  open: boolean;
  onClose: () => void;
  shortcutsRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (!open || !shortcutsRef.current) return;
    const focusable = shortcutsRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();
  }, [open, shortcutsRef]);

  if (!open) return null;

  return (
    <div
      className="stims-shell__shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
      <div
        ref={shortcutsRef}
        className="stims-shell__shortcut-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Tab' && shortcutsRef.current) {
            const focusable =
              shortcutsRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
        role="presentation"
      >
        <h2>Keyboard shortcuts</h2>
        <div className="stims-shell__shortcut-grid">
          <kbd>Space</kbd>
          <span>Demo audio</span>
          <kbd>F</kbd>
          <span>Fullscreen</span>
          <kbd>B</kbd>
          <span>Browse panel</span>
          <kbd>S</kbd>
          <span>Settings</span>
          <kbd>E</kbd>
          <span>Editor</span>
          <kbd>I</kbd>
          <span>Inspector</span>
          <kbd>N / →</kbd>
          <span>Shuffle preset</span>
          <kbd>P / ←</kbd>
          <span>Previous preset</span>
          <kbd>1–9</kbd>
          <span>Quick-select preset</span>
          <kbd>?</kbd>
          <span>This help</span>
          <kbd>Esc</kbd>
          <span>Close panels / dismiss</span>
          <kbd>Cmd+Enter</kbd>
          <span>Compile in editor</span>
        </div>
        <button type="button" className="cta-button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
