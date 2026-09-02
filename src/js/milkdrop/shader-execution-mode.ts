/**
 * One answer to "is this preset rendering as authored on this backend?".
 *
 * The compiler already decides this per backend — `ir.compatibility
 * .featureAnalysis.shaderTextExecution` — but until this module existed the
 * only consumer was the descriptor planner, which turned it into a private
 * `shaderExecution: 'direct' | 'controls'` on the WebGPU feedback plan. When
 * a preset's shader text cannot be executed, the renderer substitutes a
 * uniform-only approximation of it: a plausible-looking frame that is not the
 * preset. A Conway cellular automaton came out as a featureless smear and
 * nobody noticed for months, because nothing anywhere reported the
 * substitution.
 *
 * So the fact gets one shared vocabulary here, and every surface that should
 * be able to report it — agent snapshot, dock, debug HUD, telemetry — reads
 * it through these helpers rather than re-deriving it and drifting.
 *
 * The four modes come straight from the compiler and are deliberately not
 * renamed:
 *   'none'        — the preset authored no shader text; nothing to approximate.
 *   'direct'      — the authored shader text runs on this backend, as written.
 *   'translated'  — the shader text did not survive lowering for this backend;
 *                   the renderer drives the uniform-only controls path instead.
 *                   This is the invisible-degradation case.
 *   'unsupported' — the shader text contains lines outside the supported
 *                   subset on any backend. Also approximated, and additionally
 *                   known-lossy at parse time.
 *
 * Measured over the bundled corpus (1750 presets, 1201 carrying shader text)
 * on 2026-09-02 with shipped defaults: WebGL is 'direct' for all 1201; WebGPU
 * is 'direct' for 1033 and 'translated' for 168 (14 with the gated
 * `shaderBranchDesugar` rewrite on). Approximation is the minority, which is
 * exactly why it needs reporting — quietly-wrong presets do not show up in
 * an average. tests/corpus/butterchurn-corpus-support.test.ts pins the
 * counts.
 */
import type {
  MilkdropFeatureAnalysis,
  MilkdropRenderBackend,
} from './common-types.ts';
import type { MilkdropCompiledPreset } from './compiler-types.ts';

export type MilkdropShaderExecutionMode =
  MilkdropFeatureAnalysis['shaderTextExecution'][MilkdropRenderBackend];

/**
 * The shader-execution mode of a compiled preset on one backend, or null when
 * there is no compiled preset (boot, or a load that failed) — null is "not
 * known yet", never "fine".
 */
export function resolveShaderExecutionMode(
  compiled: MilkdropCompiledPreset | null | undefined,
  backend: MilkdropRenderBackend | null | undefined,
): MilkdropShaderExecutionMode | null {
  if (!compiled || !backend) return null;
  // Optional all the way down: this is a reporting path, and a preset whose
  // compile produced no compatibility report is exactly the case where
  // throwing would take the picture down to announce that the picture might
  // be wrong. Null says "not known", which is the truth here.
  return (
    compiled.ir?.compatibility?.featureAnalysis?.shaderTextExecution?.[
      backend
    ] ?? null
  );
}

/**
 * True when what reaches the screen is the controls approximation rather than
 * the authored shader text. 'none' is not approximated: a preset with no
 * shader text is rendered exactly as authored.
 */
export function isShaderApproximated(
  mode: MilkdropShaderExecutionMode | null | undefined,
): boolean {
  return mode === 'translated' || mode === 'unsupported';
}

/**
 * Human-readable form of an approximation, or null when nothing is being
 * approximated. Returning null for the honest cases keeps the "say nothing
 * when there is nothing to say" rule in one place instead of at every call
 * site.
 */
export function describeShaderApproximation(
  mode: MilkdropShaderExecutionMode | null | undefined,
  backend: MilkdropRenderBackend | null | undefined,
): { label: string; detail: string } | null {
  if (!isShaderApproximated(mode) || !backend) return null;
  const backendName = backend === 'webgpu' ? 'WebGPU' : 'WebGL';
  return {
    label: 'Approximated',
    detail:
      mode === 'unsupported'
        ? `This preset's shader text uses lines outside the supported subset, so ${backendName} is rendering an approximation of it rather than the preset as authored.`
        : `This preset's shader text does not run on ${backendName}, so the renderer is approximating it from its controls rather than executing it as authored.`,
  };
}
