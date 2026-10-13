/**
 * Structured shader compile diagnostics — the engine's record of GPU shader
 * programs that failed to build, kept where the editor and telemetry can
 * read it through the renderer adapter.
 *
 * Before this module a failing program vanished: the WebGL path logged the
 * driver's info log through `renderer.debug.onShaderError` (core/webgl-
 * renderer.ts) and kept going, the WebGPU composite warm-up swallowed its
 * own rejection, and the only editor-visible symptom was the stage silently
 * showing the previous frame. The editor's `renderingFallback` flag says
 * *that* something fell back — never *which program failed or why*.
 *
 * The registry is a bounded ring, not a log: a failing program reports once
 * per build, and only the most recent MAX_SHADER_COMPILE_DIAGNOSTICS
 * records are kept for `MilkdropRendererAdapter.getShaderCompileDiagnostics`
 * to expose. Recording is engine-side only; how the editor displays the
 * records is a later concern.
 *
 * WebGPU note: three's WebGPURenderer has no per-program error hook, and
 * observing a WGSL pipeline failure at all requires a live GPUDevice — which
 * the unit environment cannot provide. The WebGPU recording point is
 * therefore the composite warm-up (feedback-manager-webgpu-tsl.ts), whose
 * per-material compileAsync rejections record with exact program labels but
 * no driver log; the unit tests cover the WebGL path with a fake GL, the
 * way three itself would call it, plus this module's shared helpers.
 */

/** The GPU backend a shader failed to build on. */
export type MilkdropShaderCompileBackend = 'webgl' | 'webgpu';

/** Which part of the program failed: a shader stage, the link, or a pipeline build. */
export type MilkdropShaderCompileStage =
  | 'vertex'
  | 'fragment'
  | 'program'
  | 'pipeline';

/**
 * One structured shader compile failure. `program` names the MilkDrop
 * program the shader belonged to — 'warp' or 'comp' on the paths that can
 * attribute it, or 'unknown' when the failing shader could not be matched
 * to one.
 */
export type MilkdropShaderCompileDiagnostic = {
  backend: MilkdropShaderCompileBackend;
  program: string;
  stage: MilkdropShaderCompileStage;
  message: string;
  at: number;
};

/**
 * Bound for the diagnostics ring. A failing program reports at its first
 * use, so the ring only ever needs the recent past; older records are
 * evicted from the front.
 */
export const MAX_SHADER_COMPILE_DIAGNOSTICS = 16;

/** Driver info logs are truncated to this many characters. */
const MAX_SHADER_LOG_CHARS = 2000;

const diagnostics: MilkdropShaderCompileDiagnostic[] = [];

/**
 * Records one compile failure. An identical failure repeated back-to-back
 * (a program recompiled from the same source) updates nothing, so the ring
 * cannot fill with one repeated message.
 */
export function recordMilkdropShaderCompileDiagnostic(
  diagnostic: MilkdropShaderCompileDiagnostic,
): void {
  const message = diagnostic.message.slice(0, MAX_SHADER_LOG_CHARS);
  const newest = diagnostics.at(-1);
  if (
    newest &&
    newest.backend === diagnostic.backend &&
    newest.program === diagnostic.program &&
    newest.stage === diagnostic.stage &&
    newest.message === message
  ) {
    return;
  }
  diagnostics.push({ ...diagnostic, message });
  if (diagnostics.length > MAX_SHADER_COMPILE_DIAGNOSTICS) {
    diagnostics.splice(0, diagnostics.length - MAX_SHADER_COMPILE_DIAGNOSTICS);
  }
}

/**
 * A copy of the recorded diagnostics, oldest first, optionally only one
 * backend's. Copy so a caller's slice cannot alias the ring.
 */
export function getMilkdropShaderCompileDiagnostics(
  backend?: MilkdropShaderCompileBackend,
): MilkdropShaderCompileDiagnostic[] {
  const records = backend
    ? diagnostics.filter((record) => record.backend === backend)
    : diagnostics;
  return records.map((record) => ({ ...record }));
}

/** Empties the registry (tests, and a fresh diagnostic window). */
export function clearMilkdropShaderCompileDiagnostics(): void {
  diagnostics.length = 0;
}

/**
 * Needles that identify which MilkDrop program a compiled fragment shader
 * belongs to. three prefixes and rewrites shader sources (defines,
 * `texture2D`→`texture`), but each needle appears in exactly one stage
 * template and survives the rewrite: the warp template declares the
 * `warpUvTex` sampler and the `DIRECT_WARP_GLOBALS` block, the composite
 * template declares its `sampleCompFrame` helper.
 */
const WARP_FRAGMENT_NEEDLES = [
  'uniform sampler2D warpUvTex',
  'DIRECT_WARP_GLOBALS_START',
];
const COMP_FRAGMENT_NEEDLES = ['vec4 sampleCompFrame('];

/**
 * The MilkDrop program a fragment shader's GLSL belongs to, or 'unknown'
 * when it matches neither stage template (a batching material, a custom
 * wave program, or a shader outside the feedback chain).
 */
export function describeMilkdropShaderProgramFromFragmentGlsl(
  source: string,
): string {
  if (WARP_FRAGMENT_NEEDLES.some((needle) => source.includes(needle))) {
    return 'warp';
  }
  if (COMP_FRAGMENT_NEEDLES.some((needle) => source.includes(needle))) {
    return 'comp';
  }
  return 'unknown';
}

/**
 * The GL surface the WebGL shader-error recorder reads — the subset of
 * WebGLRenderingContext that three's onShaderError callback guarantees.
 */
export type MilkdropWebglShaderErrorContext = {
  getShaderInfoLog(shader: unknown): string | null;
  getProgramInfoLog(program: unknown): string | null;
  getShaderParameter(shader: unknown, pname: number): unknown;
  getShaderSource(shader: unknown): string | null;
  readonly COMPILE_STATUS: number;
};

/**
 * Records one WebGL shader failure from the same four handles three hands
 * its `renderer.debug.onShaderError` hook: the GL context, the linked
 * program, and the vertex/fragment shader objects. The failing stage comes
 * from each shader's COMPILE_STATUS; the message carries that stage's info
 * log plus the program's, truncated.
 */
export function recordMilkdropWebglShaderError(
  gl: MilkdropWebglShaderErrorContext,
  program: unknown,
  vertexShader: unknown,
  fragmentShader: unknown,
): void {
  const fragmentLog = (gl.getShaderInfoLog(fragmentShader) ?? '').trim();
  const vertexLog = (gl.getShaderInfoLog(vertexShader) ?? '').trim();
  const programLog = (gl.getProgramInfoLog(program) ?? '').trim();
  const fragmentBroken =
    gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS) === false;
  const vertexBroken =
    gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) === false;
  const stage: MilkdropShaderCompileStage = fragmentBroken
    ? 'fragment'
    : vertexBroken
      ? 'vertex'
      : 'program';
  // The failing stage's log first, then the link log; a pure link failure
  // already is the program log, so it is not repeated.
  const message = fragmentBroken
    ? [fragmentLog, programLog].filter(Boolean).join('\n')
    : vertexBroken
      ? [vertexLog, programLog].filter(Boolean).join('\n')
      : programLog;
  recordMilkdropShaderCompileDiagnostic({
    backend: 'webgl',
    program: describeMilkdropShaderProgramFromFragmentGlsl(
      gl.getShaderSource(fragmentShader) ?? '',
    ),
    stage,
    message: message || 'Shader program failed to link.',
    at: Date.now(),
  });
}

/**
 * The renderer surface the WebGL tracking installer needs. three's
 * WebGLRenderer exposes `debug.onShaderError`; a structurally-typed test
 * renderer provides the same field.
 */
export type MilkdropWebglShaderErrorRenderer = {
  debug?: {
    onShaderError?: (
      gl: MilkdropWebglShaderErrorContext,
      program: unknown,
      vertexShader: unknown,
      fragmentShader: unknown,
    ) => void;
  };
};

const trackedRenderers = new WeakSet<object>();

/**
 * Installs the structured-diagnostic recorder on a three WebGLRenderer,
 * composing with whatever `debug.onShaderError` hook is already there (the
 * console.error from core/webgl-renderer.ts stays live). Idempotent per
 * renderer object — feedback managers arrive by the deck, but the hook is
 * renderer-global, so only the first caller wins and later installs are
 * no-ops. Failure to read the shaders still records with what is
 * available; the installer never throws into the render path.
 */
export function installMilkdropWebglShaderErrorTracking(
  renderer: object | null | undefined,
): void {
  if (!renderer || typeof renderer !== 'object') return;
  if (trackedRenderers.has(renderer)) return;
  trackedRenderers.add(renderer);
  const debug = (renderer as MilkdropWebglShaderErrorRenderer).debug;
  if (!debug) return;
  const previous = debug.onShaderError;
  debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    try {
      recordMilkdropWebglShaderError(gl, program, vertexShader, fragmentShader);
    } catch {
      // Never let diagnostics break the render path they observe.
    }
    previous?.(gl, program, vertexShader, fragmentShader);
  };
}

/**
 * Records a WebGPU pipeline-compile failure. `program` is 'warp' or 'comp'
 * — the feedback-blend node runs the warp shader program and the composite
 * node the comp one — and comes from the per-material warm-up that caught
 * the rejection, not from the error itself: a live GPUDevice is required to
 * read a WGSL compile log, so the message is whatever the renderer threw.
 */
export function recordMilkdropWebgpuPipelineError(
  program: 'warp' | 'comp',
  error: unknown,
): void {
  recordMilkdropShaderCompileDiagnostic({
    backend: 'webgpu',
    program,
    stage: 'pipeline',
    message:
      error instanceof Error
        ? error.message || String(error)
        : String(error ?? 'unknown error'),
    at: Date.now(),
  });
}
