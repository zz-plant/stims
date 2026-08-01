type MidiControlListener = (
  cc: number,
  raw: number,
  target?: string,
  normalized?: number,
) => void;

export type MidiControlSource = {
  onControlChange: (listener: MidiControlListener) => () => void;
};

const LIVE_MILKDROP_CONTROLS = new Set([
  'zoom',
  'warp',
  'rot',
  'decay',
  'q1',
  'q2',
  'q3',
  'q4',
]);

export function bindMidiToMilkdropControls(
  midi: MidiControlSource,
  applyControl: (target: string, value: number) => void,
): () => void {
  return midi.onControlChange((_cc, _raw, target, normalized) => {
    if (
      !target ||
      normalized === undefined ||
      !Number.isFinite(normalized) ||
      !LIVE_MILKDROP_CONTROLS.has(target)
    ) {
      return;
    }
    applyControl(target, normalized);
  });
}
