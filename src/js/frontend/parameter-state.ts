/**
 * One answer to "what is driving this parameter", for every surface that asks.
 *
 * A MilkDrop field can be under any of five different regimes here, and each
 * one grew its own indicator:
 *
 *   - the preset's own per_frame/per_pixel equations recompute it each frame
 *     (`isFieldShadowedByEquations`, called independently from the editor
 *     gutter, the Settings binding rows, the MIDI HUD, and the warp gizmo)
 *   - a MIDI CC is bound to it (webmidi-controller)
 *   - the editor's Tune faders wrote a `base + depth*source` equation into the
 *     preset source (milkdrop/preset-modulation.ts)
 *   - a runtime modulator offsets it every frame without touching the source
 *     (frontend/live-modulation.ts)
 *   - nothing at all, so a written value sticks
 *
 * Four notations for one question, and no notation whatsoever for the fifth
 * regime — which is where the actual bug lives. `preset-modulation.ts`
 * measured that 9 of 11 Tune faders on a real catalog preset addressed fields
 * the preset recomputes every frame, so writes to them are discarded. A
 * runtime modulator aimed at such a field is silently dead in exactly the same
 * way, and every preset change can newly kill one, with nothing anywhere
 * reporting it.
 *
 * This module is the single place that decides. It is pure — source text and
 * plain records in, a description out — so every surface can render the same
 * vocabulary without each one re-deriving it.
 */

import {
  isFieldShadowedByEquations,
  readMilkdropField,
} from '../milkdrop/formatter.ts';
import { readModulation } from '../milkdrop/preset-modulation.ts';

/**
 * What is currently in control of a parameter's value.
 *
 * Ordered by precedence, which is also the order the render should prefer
 * when more than one applies: the preset's equations beat everything, because
 * they run last and unconditionally.
 */
export type ParameterDriver =
  | 'preset-equation'
  | 'preset-modulation'
  | 'runtime-modulation'
  | 'midi'
  | 'manual';

export type ParameterState = {
  target: string;
  driver: ParameterDriver;
  /**
   * True when something is trying to drive this parameter but the preset's
   * equations overwrite it every frame, so the control does nothing. This is
   * the state that was previously unreported for modulators.
   */
  overridden: boolean;
  /** The preset's literal value for the field, when it has one. */
  literal: number | null;
  /** Human-readable one-liner, shared by tooltips and screen-reader text. */
  summary: string;
};

export type ParameterStateInput = {
  target: string;
  /** Source text of the active preset. Null before one loads. */
  source: string | null;
  /** True when a MIDI CC is bound to this target. */
  midiBound?: boolean;
  /** True when a runtime modulator (live-modulation.ts) targets this. */
  runtimeModulated?: boolean;
  /**
   * True when the caller is offering the user a control for this parameter —
   * a pinned fader on the performance surface, say. A control is a driver
   * like any other: if the preset recomputes the field every frame, the
   * fader moves and nothing happens, which is exactly the state this module
   * exists to name. Without this flag such a fader reported a bare
   * `preset-equation` and looked like normal operation.
   */
  userControlled?: boolean;
};

const SUMMARIES: Record<ParameterDriver, string> = {
  'preset-equation': 'The preset recomputes this every frame.',
  'preset-modulation': 'Modulated by an equation in the preset.',
  'runtime-modulation': 'Modulated live, on top of its current value.',
  midi: 'Bound to a MIDI control.',
  manual: 'Holds whatever value you set.',
};

/** Appended when a driver is present but the preset overwrites it anyway. */
const OVERRIDDEN_SUFFIX =
  ' The preset overwrites it every frame, so this has no effect.';

export function describeParameterState({
  target,
  source,
  midiBound = false,
  runtimeModulated = false,
  userControlled = false,
}: ParameterStateInput): ParameterState {
  if (!source) {
    // No preset loaded: nothing can be shadowed, and nothing is known about
    // literals. Report the binding that exists rather than guessing.
    const driver: ParameterDriver = runtimeModulated
      ? 'runtime-modulation'
      : midiBound
        ? 'midi'
        : 'manual';
    return {
      target,
      driver,
      overridden: false,
      literal: null,
      summary: SUMMARIES[driver],
    };
  }

  const literal = readMilkdropField(source, target);
  const modulation = readModulation(source, target);
  const shadowed = isFieldShadowedByEquations(source, target);

  // A Tune-written modulation IS a per_frame equation, so it reads as
  // shadowed by construction. That is not the failure case — it is the
  // feature working — so it takes precedence over the raw shadow flag.
  if (modulation.kind === 'modulated') {
    return {
      target,
      driver: 'preset-modulation',
      overridden: false,
      literal,
      summary: SUMMARIES['preset-modulation'],
    };
  }

  if (shadowed) {
    // Something is driving this and the preset will overwrite it. The driver
    // reported is the one the user set up, not the equation that defeats it —
    // they need to see the thing they can act on.
    const attemptedDriver: ParameterDriver | null = runtimeModulated
      ? 'runtime-modulation'
      : midiBound
        ? 'midi'
        : userControlled
          ? 'manual'
          : null;
    if (attemptedDriver) {
      return {
        target,
        driver: attemptedDriver,
        overridden: true,
        literal,
        summary: SUMMARIES[attemptedDriver] + OVERRIDDEN_SUFFIX,
      };
    }
    return {
      target,
      driver: 'preset-equation',
      overridden: false,
      literal,
      summary: SUMMARIES['preset-equation'],
    };
  }

  const driver: ParameterDriver = runtimeModulated
    ? 'runtime-modulation'
    : midiBound
      ? 'midi'
      : 'manual';
  return {
    target,
    driver,
    overridden: false,
    literal,
    summary: SUMMARIES[driver],
  };
}

/**
 * Short label for the compact indicators (gutter glyphs, binding rows, the
 * performance HUD). Kept beside the full summaries so the two never drift
 * into describing different states.
 */
export function parameterStateLabel(state: ParameterState): string {
  if (state.overridden) return 'overridden';
  switch (state.driver) {
    case 'preset-equation':
      return 'preset';
    case 'preset-modulation':
      return 'tuned';
    case 'runtime-modulation':
      return 'modulated';
    case 'midi':
      return 'midi';
    default:
      return 'manual';
  }
}
