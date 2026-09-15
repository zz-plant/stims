/**
 * Keyboard nudges for the playing preset — zoom, warp, wave scale, rotation
 * and the wave-mode cycle — as palette actions the shortcut registry binds.
 *
 * These lived in the MilkDrop runtime as a document-level key handler
 * (`ui-bridge.ts`), a leftover of the standalone overlay that `/milkdrop/`
 * used to be. In the shell that handler was invisible: not in the shortcuts
 * dialog, not rebindable, and its status line went to the agent debug
 * snapshot rather than to a person — `i` changed the zoom and nothing on
 * screen said so. Here they are ordinary actions: listed, rebindable, and
 * announced through the same status toast as everything else.
 */

import type { EngineContextValue } from './engine-context.tsx';

export type NudgeTarget = {
  /** Preset numeric field, as spelled in the .milk source. */
  key: string;
  delta: number;
  min: number;
  max: number;
  label: string;
  /** Decimal places the field is rounded to after a step. */
  digits: number;
};

export const NUDGE_TARGETS = {
  zoom: {
    key: 'zoom',
    delta: 0.02,
    min: 0.5,
    max: 2.5,
    label: 'Zoom',
    digits: 3,
  },
  warp: { key: 'warp', delta: 0.01, min: 0, max: 1, label: 'Warp', digits: 3 },
  waveScale: {
    key: 'wave_scale',
    delta: 0.03,
    min: 0.25,
    max: 3,
    label: 'Wave scale',
    digits: 3,
  },
  rotation: {
    key: 'rot',
    delta: 0.003,
    min: -1,
    max: 1,
    label: 'Rotation',
    digits: 4,
  },
} satisfies Record<string, NudgeTarget>;

export type NudgeTargetId = keyof typeof NUDGE_TARGETS;

type NudgeEngine = Pick<
  EngineContextValue,
  'getActiveCompiledPreset' | 'applyEditorFieldsAwaited'
>;

/**
 * Steps one field by its delta in `direction`, clamped to its range, and
 * says where it landed. Returns the new value, or null when nothing is
 * playing to nudge.
 */
export async function nudgePresetField(
  engine: NudgeEngine,
  targetId: NudgeTargetId,
  direction: 1 | -1,
  announce: (message: string) => void,
): Promise<number | null> {
  const target = NUDGE_TARGETS[targetId];
  const compiled = engine.getActiveCompiledPreset();
  if (!compiled) {
    announce('Nothing is playing to adjust yet.');
    return null;
  }
  const current = compiled.ir.numericFields[target.key] ?? 0;
  const next = Math.min(
    target.max,
    Math.max(
      target.min,
      Number.parseFloat(
        (current + direction * target.delta).toFixed(target.digits),
      ),
    ),
  );
  await engine.applyEditorFieldsAwaited({ [target.key]: next });
  announce(`${target.label}: ${next.toFixed(Math.min(target.digits, 2))}`);
  return next;
}

/** MilkDrop's eight built-in waveforms, stepped in a ring. */
export const WAVE_MODE_COUNT = 8;

export async function cyclePresetWaveMode(
  engine: NudgeEngine,
  direction: 1 | -1,
  announce: (message: string) => void,
): Promise<number | null> {
  const compiled = engine.getActiveCompiledPreset();
  if (!compiled) {
    announce('Nothing is playing to adjust yet.');
    return null;
  }
  const current = Math.round(compiled.ir.numericFields.wave_mode ?? 0);
  const next =
    (((current + direction) % WAVE_MODE_COUNT) + WAVE_MODE_COUNT) %
    WAVE_MODE_COUNT;
  await engine.applyEditorFieldsAwaited({ wave_mode: next });
  announce(`Wave mode: ${next}`);
  return next;
}
