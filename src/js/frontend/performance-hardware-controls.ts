type MidiControlListener = (
  cc: number,
  raw: number,
  target?: string,
  normalized?: number,
) => void;

export type MidiControlSource = {
  onControlChange: (listener: MidiControlListener) => () => void;
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
  return midi.onControlChange((_cc, _raw, target, normalized) => {
    if (!target || normalized === undefined || !Number.isFinite(normalized)) {
      return;
    }
    applyControl(target, normalized);
  });
}
