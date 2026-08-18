import { useEffect, useRef, useState } from 'react';

const AUTO_DISMISS_MS = 6000;

export function AudioMatchToast({
  match,
  onSelect,
  onDismiss,
}: {
  match: { presetId: string; name: string; score: number } | null;
  onSelect: (presetId: string) => void;
  onDismiss: () => void;
}) {
  // The dismiss timer pauses while the toast is hovered or holds focus — a
  // fixed 6s deadline expires before a keyboard user can Tab to the action.
  const [held, setHeld] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!match || held) return;
    const timer = window.setTimeout(
      () => onDismissRef.current(),
      AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [match, held]);

  if (!match) return null;

  return (
    <div
      className="stims-shell__audio-match"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHeld(false);
        }
      }}
    >
      <span className="stims-shell__eyebrow">Audio match</span>
      <button
        type="button"
        className="stims-shell__text-button"
        onClick={() => onSelect(match.presetId)}
      >
        {match.name} — {(match.score * 100).toFixed(0)}% match
      </button>
    </div>
  );
}
