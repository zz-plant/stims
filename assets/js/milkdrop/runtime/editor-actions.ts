import type { createMilkdropEditorSession } from '../editor-session.ts';
import { upsertMilkdropFields } from '../formatter.ts';
import type { MilkdropCompiledPreset } from '../types.ts';

type MilkdropEditorSession = ReturnType<typeof createMilkdropEditorSession>;

export function createMilkdropEditorActions({
  session,
  getCompiled,
  setOverlayStatus,
}: {
  session: MilkdropEditorSession;
  getCompiled: () => MilkdropCompiledPreset;
  setOverlayStatus: (message: string) => void;
}) {
  const applyFieldValues = async (updates: Record<string, string | number>) => {
    const state = session.getState();
    const baseline = state.latestCompiled?.formattedSource ?? state.source;
    return session.applySource(upsertMilkdropFields(baseline, updates));
  };

  const nudgeNumericField = async ({
    key,
    delta,
    min,
    max,
    label,
    digits = 3,
  }: {
    key: string;
    delta: number;
    min: number;
    max: number;
    label: string;
    digits?: number;
  }) => {
    const current = getCompiled().ir.numericFields[key] ?? 0;
    const next = Math.min(
      max,
      Math.max(min, Number.parseFloat((current + delta).toFixed(digits))),
    );
    await session.updateField(key, next);
    setOverlayStatus(`${label}: ${next.toFixed(Math.min(digits, 2))}`);
  };

  const cycleWaveMode = async (direction: 1 | -1) => {
    const current = Math.round(getCompiled().ir.numericFields.wave_mode ?? 0);
    const next = (((current + direction) % 8) + 8) % 8;
    await session.updateField('wave_mode', next);
    setOverlayStatus(`Wave mode: ${next}`);
  };

  return {
    applyFieldValues,
    nudgeNumericField,
    cycleWaveMode,
  };
}
