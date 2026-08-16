export function AudioMatchToast({
  match,
  onSelect,
}: {
  match: { presetId: string; name: string; score: number } | null;
  onSelect: (presetId: string) => void;
}) {
  if (!match) return null;

  return (
    <div
      className="stims-shell__audio-match"
      role="status"
      aria-live="polite"
      aria-atomic="true"
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
