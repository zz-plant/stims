import { UiIcon } from './UiIcon.tsx';

export function WorkspaceToast({
  toast,
}: {
  toast: {
    message: string;
    tone: 'info' | 'warn' | 'error';
    exiting?: boolean;
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
      // Drives the `toast-exit` keyframe in app-shell.css, which had sat
      // unused because nothing ever set this.
      data-exit={toast.exiting ? 'true' : undefined}
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
    </output>
  );
}
