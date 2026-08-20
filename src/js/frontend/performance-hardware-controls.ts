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
