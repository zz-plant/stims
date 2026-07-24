export function AudioMatchToast({
  match,
  onSelect,
  onDismiss,
}: {
  match: { presetId: string; name: string; score: number } | null;
  onSelect: (presetId: string) => void;
  onDismiss: () => void;
}) {
  if (!match) return null;

  return (
    <div className="stims-shell__audio-match">
      <span className="stims-shell__eyebrow">Audio match</span>
      <button
        type="button"
        className="stims-shell__text-button"
        onClick={() => onSelect(match.presetId)}
      >
        {match.name} — {(match.score * 100).toFixed(0)}% match
      </button>
      <button
        type="button"
        className="stims-shell__audio-match-close"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
