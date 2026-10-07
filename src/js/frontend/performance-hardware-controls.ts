import { MIDI_CONTROLLER_PROFILES } from './midi-controller-presets.ts';
import { describePinnableField } from './perform-pins.ts';

type MidiControlListener = (
  cc: number,
  raw: number,
  target?: string,
  normalized?: number,
  deviceId?: string,
) => void;

type MidiNoteListener = (event: {
  target?: string;
  value?: number;
  deviceId: string;
}) => void;

export type MidiControlSource = {
  onControlChange: (listener: MidiControlListener) => () => void;
  /** Pads/keys. Absent on older stubs, so callers must tolerate undefined. */
  onNote?: (listener: MidiNoteListener) => () => void;
  /** Push a value back to bound controls for LED/motor feedback. */
  publishTargetValue?: (
    target: string,
    value: number,
    originDeviceId?: string,
  ) => void;
};

// engine.updateInspectorField/session.updateField already accepts any
// field name — it's the same path the inspector panel's freeform fields
// use — so a fixed allowlist here only stopped a controller from driving
// a preset's own custom q-vars or ib_*/mv_* registers. Any target learned
// through MIDI-learn (or set directly by name) is trusted as-is.
export function bindMidiToMilkdropControls(
  midi: MidiControlSource,
  applyControl: (target: string, value: number) => void,
): () => void {
  const apply = (
    target: string | undefined,
    value: number | undefined,
    deviceId: string | undefined,
  ) => {
    if (!target || value === undefined || !Number.isFinite(value)) return;
    applyControl(target, value);
    // Mirror the new value onto every OTHER bound control, so a second
    // controller's LED ring and a motorised fader both track a change made
    // from the first one (or from the UI).
    midi.publishTargetValue?.(target, value, deviceId);
  };

  const unbindControl = midi.onControlChange(
    (_cc, _raw, target, normalized, deviceId) =>
      apply(target, normalized, deviceId),
  );
  const unbindNote = midi.onNote?.((event) =>
    apply(event.target, event.value, event.deviceId),
  );

  return () => {
    unbindControl();
    unbindNote?.();
  };
}

/**
 * The crossfader, as a control target. Not a preset field: the factory
 * profiles bind a fader to it, and sent down the field path it wrote a
 * `crossfade=` line into the running preset's code instead of fading.
 */
export const CROSSFADE_TARGET = 'crossfade';

/**
 * Applies hardware control values to the stage.
 *
 * A field moves the running preset at once (a live write to the VM, no
 * compile) and is committed to the preset's source only once the control
 * has been still for `commitDelayMs`. Committing every message recompiled
 * the preset on the main thread for each one: 0.7-3.6ms per message on
 * bundled presets and 3-8ms on the largest, at the rate a knob sends them.
 *
 * The crossfader goes to `crossfade` and never touches the preset.
 */
export function createPerformanceControlApplier({
  setFieldLive,
  commitField,
  crossfade,
  commitDelayMs = 250,
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  setFieldLive: (target: string, value: number) => void;
  commitField: (target: string, value: number) => void;
  crossfade: (position: number) => void;
  commitDelayMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}) {
  const pending = new Map<string, unknown>();
  return {
    apply(target: string, value: number) {
      if (target === CROSSFADE_TARGET) {
        crossfade(value);
        return;
      }
      setFieldLive(target, value);
      const previous = pending.get(target);
      if (previous !== undefined) cancel(previous);
      pending.set(
        target,
        schedule(() => {
          pending.delete(target);
          commitField(target, value);
        }, commitDelayMs),
      );
    },
    dispose() {
      for (const handle of pending.values()) cancel(handle);
      pending.clear();
    },
  };
}

/**
 * The range a learned control should sweep for `target`, or null for 0-1.
 *
 * Learn used to bind every control across 0-1, so a knob learned to zoom
 * spent most of its travel past anything a preset can use. The Perform
 * surface's own fader ranges come first, then the factory profiles' ranges
 * for the same target.
 */
export function learnRangeFor(
  target: string,
): { min: number; max: number } | null {
  const pinnable = describePinnableField(target);
  if (pinnable) return { min: pinnable.min, max: pinnable.max };
  for (const profile of MIDI_CONTROLLER_PROFILES) {
    for (const binding of Object.values(profile.ccBindings)) {
      if (binding.target === target) {
        return { min: binding.min, max: binding.max };
      }
    }
  }
  return null;
}

/** Fader travel off its resting end before it pulls in the next preset. */
const CROSSFADE_START_THRESHOLD = 0.05;
/** How long a started fade may take to go live (its preset loading). */
const CROSSFADE_ARM_TIMEOUT_MS = 4000;
/** Spacing between repeats of the same "nothing to fade into" notice. */
const CROSSFADE_NOTICE_INTERVAL_MS = 4000;

export type QueuedCrossfadeResult = 'started' | 'empty' | 'already-active';

/**
 * A hardware crossfader over the cue deck, DJ-style.
 *
 * Pushed off its resting end it takes the next queued preset (what the cue
 * deck's "Fade by hand" does) and from then on drives the fade. A fade that
 * finished leaves the fader at the other end, and that end becomes the new
 * resting end, so the next push back across starts the next fade instead of
 * dragging a finished one.
 */
export function createHardwareCrossfader({
  getPosition,
  setPosition,
  startQueued,
  announce,
  now = () => performance.now(),
}: {
  /** The live fade's position, or null when no manual fade is running. */
  getPosition: () => number | null;
  setPosition: (position: number) => void;
  startQueued: () => QueuedCrossfadeResult;
  announce: (message: string) => void;
  now?: () => number;
}) {
  let restingAt: 0 | 1 = 0;
  let wasLive = false;
  let lastValue = 0;
  let armedAt: number | null = null;
  let lastNoticeAt = Number.NEGATIVE_INFINITY;

  return {
    move(value: number) {
      const live = getPosition() !== null;
      if (wasLive && !live) {
        restingAt = lastValue >= 0.5 ? 1 : 0;
        armedAt = null;
      }
      wasLive = live;
      lastValue = value;
      const position = restingAt === 0 ? value : 1 - value;

      if (live) {
        armedAt = null;
        setPosition(position);
        return;
      }
      // Started and still loading the incoming preset: the fade is not
      // live yet, and starting another would take a second queue entry.
      if (armedAt !== null && now() - armedAt < CROSSFADE_ARM_TIMEOUT_MS) {
        return;
      }
      armedAt = null;
      if (position < CROSSFADE_START_THRESHOLD) return;

      const result = startQueued();
      if (result === 'started') {
        armedAt = now();
        return;
      }
      if (now() - lastNoticeAt >= CROSSFADE_NOTICE_INTERVAL_MS) {
        lastNoticeAt = now();
        announce(
          result === 'empty'
            ? 'Queue a preset to crossfade into it.'
            : 'The next queued preset is already on the stage.',
        );
      }
    },
  };
}
