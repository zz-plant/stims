import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

type ConfirmDialogProps = {
  message: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export function ConfirmDialog({
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown as EventListener);
    return () => {
      document.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [onCancel]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: overlay click-to-dismiss for mouse users; keyboard users use Escape or Cancel button */}
      <div className="stims-shell__confirm-overlay" onClick={onCancel}>
        <div
          className="stims-shell__confirm-dialog"
          onClick={(event) => event.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
          aria-label={message}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onConfirm();
            }
          }}
        >
          <h3>{message}</h3>
          {details ? <p>{details}</p> : null}
          {children}
          <div className="stims-shell__confirm-actions">
            <button type="button" className="cta-button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="cta-button primary"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
