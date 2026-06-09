export function WorkspaceToast({
  onDismiss,
  toast,
}: {
  onDismiss: () => void;
  toast: {
    message: string;
    tone: 'info' | 'warn' | 'error';
  } | null;
}) {
  if (!toast) {
    return null;
  }

  const symbols = {
    info: 'ℹ️',
    warn: '⚠️',
    error: '🚫',
  };
  const symbol = symbols[toast.tone] ?? 'ℹ️';

  return (
    <output
      className="stims-shell__toast"
      data-tone={toast.tone}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span>
        <span style={{ marginRight: 6 }} aria-hidden="true">
          {symbol}
        </span>
        {toast.message}
      </span>
      <button
        type="button"
        className="stims-shell__toast-dismiss"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </output>
  );
}
