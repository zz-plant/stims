import type { createMilkdropEditorSession } from '../editor-session.ts';

type MilkdropEditorSession = ReturnType<typeof createMilkdropEditorSession>;

/**
 * Field edits against the live editor session.
 *
 * The keyboard nudges (zoom, warp, wave scale, wave mode) that used to live
 * beside this moved to the shell — `frontend/preset-nudges.ts` — where they
 * are listed, rebindable and announced. This keeps only the seam they and
 * the editor share.
 */
export function createMilkdropEditorActions({
  session,
}: {
  session: MilkdropEditorSession;
}) {
  // Baseline selection lives in the session: it is the only place that knows
  // about sources committed but not yet compiled. Reading it from the public
  // state here meant a nudge issued during a compile silently reverted the
  // nudge before it.
  const applyFieldValues = async (updates: Record<string, string | number>) =>
    session.updateFields(updates);

  return {
    applyFieldValues,
  };
}
