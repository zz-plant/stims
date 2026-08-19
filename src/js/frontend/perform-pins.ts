/**
 * Which parameters the performer has promoted to the stage.
 *
 * The alternative — designing a fixed performance panel — cannot work here,
 * because the right set is per-person and per-set. Settings already carries
 * 857 lines mixing configuration with performance controls, and no single
 * arrangement satisfies both a first-run visitor and someone mid-set. So the
 * surface is empty by default and the performer fills it, the way
 * TouchDesigner's perform mode promotes parameters out of the network.
 *
 * The pinned unit is a MilkDrop field name, deliberately the same vocabulary
 * MIDI bindings, runtime modulators, and parameter-state.ts already use. That
 * is what makes a pin composable: a pinned field can also be MIDI-bound and
 * modulated, and all three describe it with the same words.
 */

const STORAGE_KEY = 'stims:perform-pins:v1';

/**
 * Fields offered by the picker.
 *
 * Ranges match `DEFAULT_MIDI_CC_BINDINGS` where they overlap, so a field
 * behaves identically whether you reach it from a fader here or a knob on a
 * controller. A parameter whose travel meant something different depending on
 * which surface moved it would be worse than no parameter at all.
 */
export const PINNABLE_FIELDS: ReadonlyArray<{
  target: string;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { target: 'zoom', label: 'Zoom', min: 0.8, max: 1.2, step: 0.001 },
  { target: 'warp', label: 'Warp', min: 0, max: 2, step: 0.01 },
  { target: 'rot', label: 'Rotate', min: -0.2, max: 0.2, step: 0.001 },
  { target: 'decay', label: 'Decay', min: 0.85, max: 1, step: 0.001 },
  { target: 'cx', label: 'Centre X', min: 0, max: 1, step: 0.01 },
  { target: 'cy', label: 'Centre Y', min: 0, max: 1, step: 0.01 },
  { target: 'dx', label: 'Drift X', min: -0.1, max: 0.1, step: 0.001 },
  { target: 'dy', label: 'Drift Y', min: -0.1, max: 0.1, step: 0.001 },
  { target: 'sx', label: 'Stretch X', min: 0.9, max: 1.1, step: 0.001 },
  { target: 'sy', label: 'Stretch Y', min: 0.9, max: 1.1, step: 0.001 },
  { target: 'wave_a', label: 'Wave alpha', min: 0, max: 1, step: 0.01 },
  { target: 'q1', label: 'q1', min: 0, max: 1, step: 0.01 },
  { target: 'q2', label: 'q2', min: 0, max: 1, step: 0.01 },
  { target: 'q3', label: 'q3', min: 0, max: 1, step: 0.01 },
  { target: 'q4', label: 'q4', min: 0, max: 1, step: 0.01 },
];

const PINNABLE_BY_TARGET = new Map(
  PINNABLE_FIELDS.map((field) => [field.target, field]),
);

export function describePinnableField(target: string) {
  return PINNABLE_BY_TARGET.get(target) ?? null;
}

/**
 * Pins live in a module store rather than in component state.
 *
 * Two callers need to agree on them: the panel, and the agent bridge (an
 * automated set has to be able to pin a fader without clicking one). A
 * `useState` seeded from storage would let those two drift the moment either
 * wrote, so the store is the single source and the panel subscribes.
 */
let pinnedTargets: string[] | null = null;
const pinListeners = new Set<() => void>();

function loadPinnedTargets(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Drop anything the picker no longer offers rather than rendering a
    // control with no range: a stale pin from an older build must degrade to
    // absent, not to a slider that writes nonsense.
    return parsed.filter(
      (value): value is string =>
        typeof value === 'string' && PINNABLE_BY_TARGET.has(value),
    );
  } catch {
    return [];
  }
}

function persist(targets: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
  } catch (error) {
    // Private-mode and quota failures must not take the panel down with
    // them: the pins still work for this session, they just will not
    // survive a reload. Worth a line in the console, not a toast.
    console.debug('[stims] Could not persist performance pins.', error);
  }
}

export function getPinnedTargets(): string[] {
  pinnedTargets ??= loadPinnedTargets();
  return pinnedTargets;
}

export function subscribeToPinnedTargets(listener: () => void): () => void {
  pinListeners.add(listener);
  return () => {
    pinListeners.delete(listener);
  };
}

function setPinnedTargets(next: string[]): void {
  pinnedTargets = next;
  persist(next);
  for (const listener of pinListeners) listener();
}

/** Adds a pin. Unknown fields are rejected rather than stored, so an agent
 * typo cannot persist a control the picker has no range for. */
export function pinTarget(target: string): boolean {
  if (!PINNABLE_BY_TARGET.has(target)) return false;
  const current = getPinnedTargets();
  if (current.includes(target)) return true;
  setPinnedTargets([...current, target]);
  return true;
}

export function unpinTarget(target: string): boolean {
  const current = getPinnedTargets();
  if (!current.includes(target)) return false;
  setPinnedTargets(current.filter((value) => value !== target));
  return true;
}

/**
 * Opening the picker from outside the panel.
 *
 * The surface renders nothing while nothing is pinned, which is right for the
 * 99% who never pin anything — but it also means there is no control to click
 * to pin the first one. The dock and the palette raise this signal instead,
 * and the panel mounts itself with the picker already open.
 */
const pickerListeners = new Set<() => void>();

export function openPerformPicker(): void {
  for (const listener of pickerListeners) listener();
}

export function subscribeToPerformPicker(listener: () => void): () => void {
  pickerListeners.add(listener);
  return () => {
    pickerListeners.delete(listener);
  };
}
