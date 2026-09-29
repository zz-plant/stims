/**
 * Solo and mute for a preset's custom waves and shapes.
 *
 * Working out which of eight overlapping elements makes a given streak is the
 * common question when reading someone else's preset, and the only answer
 * MilkDrop offered was editing `enabled=0` into the file and remembering to
 * take it out. This is that toggle without touching the source: a hidden
 * element skips drawing exactly as if `enabled` were 0 that frame, while its
 * per-frame code still runs, so the rest of the preset evolves as it would.
 * Soloing an element hides every other custom wave and shape and the main
 * waveform.
 *
 * The state is tied to the preset it was set for, so it lapses on its own
 * when the preset changes. Kept dependency-free so the editor chunk can import
 * it without pulling in the runtime (see variable-probe.ts).
 */

export type IsolationKind = 'wave' | 'shape';

export type IsolatedElement = {
  kind: IsolationKind;
  /** The IR's 1-based slot index (`wave_0` in the file is index 1). */
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
 * Whether the frame builder should skip drawing this element. `main-wave` is
 * hidden only while something is soloed. Cheap when nothing is isolated: the
 * builders call this for every element on every frame.
 */
export function isElementHidden(
  presetId: string,
  kind: IsolationKind | 'main-wave',
  index = 0,
): boolean {
  const state = current;
  if (state === null || state.presetId !== presetId) {
    return false;
  }
  if (kind === 'main-wave') {
    return state.solo !== null;
  }
  if (state.solo) {
    return state.solo.kind !== kind || state.solo.index !== index;
  }
  return state.muted.some(
    (entry) => entry.kind === kind && entry.index === index,
  );
}
