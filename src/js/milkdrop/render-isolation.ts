/**
 * Solo and mute for what a preset draws: its custom waves and shapes, the
 * main waveform, the borders and the motion vectors.
 *
 * Working out which of eight overlapping elements makes a given streak is the
 * common question when reading someone else's preset, and the only answer
 * MilkDrop offered was editing `enabled=0` into the file and remembering to
 * take it out. This is that toggle without touching the source: a hidden
 * element skips drawing exactly as if `enabled` were 0 that frame, while its
 * per-frame code still runs, so the rest of the preset evolves as it would.
 * Soloing an element hides every other one of these: what is left is that
 * element over the warped feedback, which no toggle hides, because it is the
 * picture's memory of everything already drawn.
 *
 * The state is tied to the preset it was set for, so it lapses on its own
 * when the preset changes. Kept dependency-free so the editor chunk can import
 * it without pulling in the runtime (see variable-probe.ts).
 */

/** A custom wave or shape slot, or one of the layers every preset has. */
export type IsolationKind =
  | 'wave'
  | 'shape'
  | 'main-wave'
  | 'borders'
  | 'motion-vectors';

export type IsolatedElement = {
  kind: IsolationKind;
  /** The IR's 1-based slot index (`wave_0` in the file is index 1); 0 for
   * the main waveform, borders and motion vectors, of which there is one. */
  index: number;
};

export type RenderIsolation = {
  presetId: string;
  solo: IsolatedElement | null;
  muted: readonly IsolatedElement[];
};

type IsolationListener = (isolation: RenderIsolation | null) => void;

let current: RenderIsolation | null = null;
const listeners = new Set<IsolationListener>();

const same = (a: IsolatedElement, b: IsolatedElement) =>
  a.kind === b.kind && a.index === b.index;

function commit(next: RenderIsolation | null) {
  current = next && (next.solo || next.muted.length > 0) ? { ...next } : null;
  for (const listener of listeners) listener(current);
}

function forPreset(presetId: string): RenderIsolation {
  return current?.presetId === presetId
    ? current
    : { presetId, solo: null, muted: [] };
}

export function getRenderIsolation(): RenderIsolation | null {
  return current;
}

export function subscribeRenderIsolation(
  listener: IsolationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Solo an element, or pass it again to un-solo. */
export function toggleSolo(presetId: string, element: IsolatedElement) {
  const state = forPreset(presetId);
  commit({
    ...state,
    solo: state.solo && same(state.solo, element) ? null : element,
  });
}

export function toggleMute(presetId: string, element: IsolatedElement) {
  const state = forPreset(presetId);
  const isMuted = state.muted.some((entry) => same(entry, element));
  commit({
    ...state,
    muted: isMuted
      ? state.muted.filter((entry) => !same(entry, element))
      : [...state.muted, element],
  });
}

export function clearRenderIsolation() {
  commit(null);
}

/**
 * Whether the frame builder should skip drawing this element. Cheap when
 * nothing is isolated: the builders call this for every element on every
 * frame.
 */
export function isElementHidden(
  presetId: string,
  kind: IsolationKind,
  index = 0,
): boolean {
  const state = current;
  if (state === null || state.presetId !== presetId) {
    return false;
  }
  if (state.solo) {
    return state.solo.kind !== kind || state.solo.index !== index;
  }
  return state.muted.some(
    (entry) => entry.kind === kind && entry.index === index,
  );
}
