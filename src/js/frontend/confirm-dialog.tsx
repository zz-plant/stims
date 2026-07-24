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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const detailsId = details ? 'confirm-dialog-details' : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    confirmRef.current?.focus();
  }, []);

  const handleClose = () => {
    onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      className="stims-shell__confirm-dialog"
      aria-label={message}
      aria-describedby={detailsId}
      onClose={handleClose}
    >
      <h3>{message}</h3>
      {details ? <p id={detailsId}>{details}</p> : null}
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
    </dialog>
  );
}
