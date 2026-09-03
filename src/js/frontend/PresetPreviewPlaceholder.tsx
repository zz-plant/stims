/**
 * What the art slot shows when there is no real frame of the preset yet.
 *
 * This replaces a generated picture — a hash-derived waveform over a bloom —
 * that was drawn to fill the slot "exactly as a real thumbnail would, so a
 * catalog that is part thumbnailed and part generated still reads as one grid
 * rather than two". That was the bug: making the two indistinguishable is
 * precisely what a reader needs them not to be. None of it came from the
 * preset, so every tile it filled was a claim about a preset that nothing had
 * looked at.
 *
 * A preview is now either a frame the preset actually rendered (a thumbnail
 * from R2, a runtime snapshot, or an on-demand capture — see
 * preset-still-capture.ts) or it is absent and says so. This component is the
 * "says so": deliberately typographic, with no depiction of any kind, because
 * anything drawn here would be read as the preset. The two states it can
 * report are both true statements — the renderer is working on it, or the
 * preset could not produce a frame.
 */
import { memo } from 'react';

export type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

export type PresetPreviewPlaceholderState = 'capturing' | 'unavailable';

export const PresetPreviewPlaceholder = memo(function PresetPreviewPlaceholder({
  state,
}: {
  state: PresetPreviewPlaceholderState;
}) {
  return (
    <div
      className="stims-shell__preset-art-placeholder"
      data-state={state}
      aria-hidden="true"
    >
      <span className="stims-shell__preset-art-placeholder-label">
        {state === 'capturing' ? 'Rendering preview…' : 'No preview'}
      </span>
    </div>
  );
});
