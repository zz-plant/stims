import type { createMilkdropEditorSession } from '../editor-session.ts';
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
  // Baseline selection lives in the session: it is the only place that knows
  // about sources committed but not yet compiled. Reading it from the public
  // state here meant a nudge issued during a compile silently reverted the
  // nudge before it.
  const applyFieldValues = async (updates: Record<string, string | number>) =>
    session.updateFields(updates);

  const updateFieldValues = async (updates: Record<string, string | number>) =>
    applyFieldValues(updates);

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
    await applyFieldValues({ [key]: next });
    setOverlayStatus(`${label}: ${next.toFixed(Math.min(digits, 2))}`);
  };

  const cycleWaveMode = async (direction: 1 | -1) => {
    const current = Math.round(getCompiled().ir.numericFields.wave_mode ?? 0);
    const next = (((current + direction) % 8) + 8) % 8;
    await applyFieldValues({ wave_mode: next });
    setOverlayStatus(`Wave mode: ${next}`);
  };

  return {
    applyFieldValues,
    updateFieldValues,
    nudgeNumericField,
    cycleWaveMode,
  };
}
