import { UiIcon } from './UiIcon.tsx';

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

  const iconName =
    toast.tone === 'error'
      ? 'error'
      : toast.tone === 'warn'
        ? 'warning'
        : 'info';

  return (
    <output
      className="stims-shell__toast"
      data-tone={toast.tone}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="stims-shell__toast-content">
        <UiIcon
          name={iconName}
          className="stims-shell__toast-icon stims-icon-slot stims-icon-slot--sm"
        />
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
