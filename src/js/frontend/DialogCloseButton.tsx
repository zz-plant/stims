import { UiIcon } from './UiIcon.tsx';

/**
 * The × in a shell dialog's header (`stims-shell__dialog-head`). It sits
 * beside the title so a long, scrolling card can be closed without reading to
 * its end; the side panels' close button carries the same Esc hint.
 */
export function DialogCloseButton({
  label,
  onClose,
}: {
  /** What a screen reader hears, e.g. "Close shortcuts". */
  label: string;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className="cta-button ghost stims-shell__dialog-close"
      onClick={onClose}
      aria-label={label}
      title="Close (Esc)"
      aria-keyshortcuts="Escape"
    >
      <UiIcon name="close" className="stims-icon-slot stims-icon-slot--sm" />
    </button>
  );
}
