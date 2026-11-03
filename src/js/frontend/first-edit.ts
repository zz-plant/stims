import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { analyzeProgramReferences } from 'milkdrop-toolchain/src/program-references.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { applyRecipe } from '../milkdrop/cookbook.ts';

export interface SpinExample {
  before: string;
  after: string;
}

/**
 * Adds to the author's equations rather than replacing them; one click can
 * undo this exact edit without touching anything the visitor adds afterwards.
 *
 * The per-pixel program runs after the per-frame one, seeded with its `rot`,
 * so where it writes `rot` a per-frame change may never reach the warp. Going
 * last in the per-pixel program reaches it whatever that code does; everywhere
 * else the per-frame line is enough, and adds no per-vertex work.
 */
export function addSpinExample(source: string): SpinExample {
  const { perPixel } = compileMilkdropPresetSource(source).ir.programs;
  const block = analyzeProgramReferences(perPixel).writes.has('rot')
    ? 'perPixel'
    : 'perFrame';
  return {
    before: source,
    after: applyRecipe(source, { code: { [block]: ['rot=rot+0.02;'] } }).source,
  };
}

/**
 * A warp shader that never reads `uv` samples coordinates of its own, so no
 * `rot` can reach the picture and the guide has no spin to promise.
 */
export function spinCanShow(warpShader: string | null | undefined): boolean {
  return !warpShader || /\buv\b/u.test(warpShader);
}

export function undoSpinExample(
  source: string,
  edit: SpinExample,
): string | null {
  return source === edit.after ? edit.before : null;
}

/**
 * The funnel's first-edit step, finer-grained than the frozen
 * `first-edit-applied` (the guide button). Each helper fires its growth
 * event once per page load — a session is a page load for these beacons,
 * and a second edit must not be able to re-answer a question the first one
 * already did. Module-level, not component state: the editor panel unmounts
 * on every close, and a once-per-session event that reset with it counted
 * per open instead.
 *
 * What counts as the edit itself:
 *  - a code edit is a change the visitor typed, pasted, cut or dropped into
 *    the code (CodeMirror's user events), applied when its debounce commits
 *    the draft — the same moment `updateEditorSource` hands it to the engine;
 *  - a Tune edit is the first value any Tune-pane control writes into the
 *    draft. AI proposals, agent applies and the guide button are none of
 *    these and fire nothing.
 */
let codeEditNoted = false;
let tuneEditNoted = false;

/** Fires `growth-first-code-edit-applied` for this page load's first
 * visitor-typed code edit. */
export function noteFirstCodeEditAppliedOnce(): void {
  if (codeEditNoted) return;
  codeEditNoted = true;
  noteGrowthEvent('first-code-edit-applied');
}

/** Fires `growth-first-tune-edit-applied` for this page load's first
 * committed Tune control. */
export function noteFirstTuneEditAppliedOnce(): void {
  if (tuneEditNoted) return;
  tuneEditNoted = true;
  noteGrowthEvent('first-tune-edit-applied');
}

/** Test-only: forget the once guards so a fresh session can be simulated. */
export function resetFirstEditNotedForTests(): void {
  codeEditNoted = false;
  tuneEditNoted = false;
}
