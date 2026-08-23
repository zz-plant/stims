import { useEffect, useMemo, useState } from 'react';
import { getBrowserStorage } from '../core/state/browser-storage.ts';
import { parseURLParams } from '../core/url-params.ts';
import type { MilkdropCompiledPreset } from '../milkdrop/compiler-types.ts';
import { isShaderApproximated } from '../milkdrop/shader-execution-mode.ts';
import { useEngine, useEngineSnapshot } from './engine-context.tsx';
import { UiIcon } from './UiIcon.tsx';

/**
 * On-canvas debug HUD, mounted for `?debug=hud` (and its `?stats=1` alias).
 *
 * This is the *only* performance/diagnostic surface. `?stats=1` used to open a
 * second, unrelated floating panel backed by the stats-gl vendor chunk, which
 * answered the same question ("is it running fast?") in a different visual
 * language and could be on screen at the same time as this one. That
 * implementation is gone; the flag now opens this HUD.
 *
 * Every number here is read from a real source — measured frames, the
 * adaptive-quality controller, the live audio energy on the engine snapshot,
 * and the active preset's compiled IR. Nothing is simulated: a debug overlay
 * that invents plausible values is worse than no overlay, because it reads as
 * evidence while telling you nothing about the engine.
 *
 * One deliberate limitation, labelled in the UI: the uniform table shows the
 * preset's *authored* base values from `ir.numericFields`, not the per-frame
 * results of the per_frame equations. Live VM state is not exposed on the
 * frontend seam, and copying it out every frame would tax a render loop that
 * already runs to a measured ~4ms floor. Base values still answer the common
 * question ("what did this preset actually declare?") without that cost.
 */

/** Sampled over this window; long enough to be stable, short enough to feel live. */
const FPS_SAMPLE_MS = 500;

/**
 * The MilkDrop motion/color fields worth a permanent slot. Ordered by how
 * often they explain a "why does it look like that" question, not
 * alphabetically.
 */
const TRACKED_UNIFORMS = [
  'zoom',
  'rot',
  'warp',
  'decay',
  'cx',
  'cy',
  'dx',
  'dy',
  'wave_r',
  'wave_g',
  'wave_b',
  'wave_a',
] as const;

function formatUniform(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

type ShaderStageState = 'absent' | 'lowered' | 'approximated';

type LoweringSummary = {
  warp: ShaderStageState;
  comp: ShaderStageState;
  /** True only when the preset authored no warp *and* no comp shader. */
  noCustomShaders: boolean;
  unsupportedLines: number;
  errors: number;
  warnings: number;
};

/**
 * `ir.shaderText.supported` is `false` both for a preset whose shaders we
 * could not fully lower *and* for a preset that has no shaders at all —
 * the flag is `hasSupportedText && !hasUnsupportedText`. Reporting the second
 * case as "unsupported" sends you hunting for a lowering bug in a preset that
 * never had a shader, so the two are split apart here.
 */
function summarizeLowering(
  compiled: MilkdropCompiledPreset | null,
): LoweringSummary | null {
  if (!compiled) return null;
  const shader = compiled.ir.shaderText;
  const stage = (
    text: string | null,
    program: unknown | null,
  ): ShaderStageState => {
    if (text === null) return 'absent';
    return program !== null ? 'lowered' : 'approximated';
  };
  return {
    warp: stage(shader.warp, shader.warpProgram),
    comp: stage(shader.comp, shader.compProgram),
    noCustomShaders: shader.warp === null && shader.comp === null,
    unsupportedLines: shader.unsupportedLines.length,
    errors: compiled.diagnostics.filter((d) => d.severity === 'error').length,
    warnings: compiled.diagnostics.filter((d) => d.severity === 'warning')
      .length,
  };
}

/**
 * Persisted opt-in inherited from the retired stats overlay. `?stats=1` was
 * sticky across reloads — which is what makes it usable in agent mode, where
 * the page reloads between steps — so the alias keeps that behaviour instead of
 * silently becoming a one-shot flag.
 */
const HUD_STORAGE_KEY = 'stims:debug:hud';

/**
 * Resolves the HUD's visibility from the URL and the persisted flag.
 *
 * `?debug=hud` is the primary spelling and is not sticky. `?stats=1` / `?stats=0`
 * write through to storage so the setting survives a reload.
 */
export function shouldEnableDebugHud({
  search = typeof window !== 'undefined' ? window.location.search : '',
  storageValue,
}: {
  search?: string;
  storageValue?: string | null;
} = {}): boolean {
  const params = parseURLParams(search);
  if (params.flags.debug === 'hud') return true;
  if (params.stats === '1') return true;
  if (params.stats === '0') return false;
  return storageValue === '1';
}

function useHudEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storage = getBrowserStorage();
    const stats = parseURLParams().stats;
    if (stats === '1' || stats === '0') {
      storage?.setItem(HUD_STORAGE_KEY, stats);
    }
    setEnabled(
      shouldEnableDebugHud({
        storageValue: storage?.getItem(HUD_STORAGE_KEY) ?? null,
      }),
    );
  }, []);
  return enabled;
}

/**
 * Counts presented animation frames. Same technique as `useAgentFrameRate`,
 * and for the same reason documented there: the renderer's own
 * `averageFrameMs` measures CPU work inside a frame rather than the frame
 * period, so it cannot be turned into an FPS figure.
 */
function useMeasuredFps(active: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    let rafId = 0;
    let frames = 0;
    let windowStart = performance.now();
    let disposed = false;

    const tick = (now: number) => {
      if (disposed) return;
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= FPS_SAMPLE_MS) {
        setFps(Math.round((frames / elapsed) * 1000));
        frames = 0;
        windowStart = now;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [active]);

  return fps;
}

export function HudOverlay() {
  const enabled = useHudEnabled();
  const [dismissed, setDismissed] = useState(false);
  const visible = enabled && !dismissed;

  const { engineSnapshot } = useEngineSnapshot();
  const { getActiveCompiledPreset } = useEngine();
  const fps = useMeasuredFps(visible);

  const activePresetId = engineSnapshot?.activePresetId ?? null;

  // The IR is immutable per compile, so re-reading it is keyed on the preset
  // id rather than polled: `activePresetId` is both the guard below and the
  // signal that a new compile has landed.
  const compiled = useMemo(() => {
    if (!visible || !activePresetId) return null;
    return getActiveCompiledPreset();
  }, [visible, getActiveCompiledPreset, activePresetId]);

  const lowering = useMemo(() => summarizeLowering(compiled), [compiled]);
  const numericFields = compiled?.ir.numericFields ?? null;

  if (!visible) return null;

  const shaderExecution = engineSnapshot?.shaderExecution ?? null;
  const quality = engineSnapshot?.adaptiveQuality ?? null;
  const audioEnergy = engineSnapshot?.audioEnergy ?? 0;
  const energyPercent = Math.round(Math.min(1, Math.max(0, audioEnergy)) * 100);

  return (
    <aside
      className="stims-shell__debug-hud"
      role="status"
      aria-label="GPU debug HUD"
    >
      <header className="stims-shell__debug-hud-header">
        <span className="stims-shell__debug-hud-title">Debug HUD</span>
        <button
          type="button"
          className="stims-shell__debug-hud-close"
          onClick={() => setDismissed(true)}
          aria-label="Hide debug HUD"
        >
          <UiIcon
            name="close"
            className="stims-icon-slot stims-icon-slot--sm"
          />
        </button>
      </header>

      <dl className="stims-shell__debug-hud-grid">
        <dt>Backend</dt>
        <dd>{engineSnapshot?.backend ?? '—'}</dd>

        <dt>Frames</dt>
        <dd>{fps === null ? 'sampling…' : `${fps} fps`}</dd>

        <dt>Frame cost</dt>
        <dd>
          {/* averageFrameMs is null until the controller has samples. */}
          {quality
            ? `${quality.averageFrameMs === null ? '—' : quality.averageFrameMs.toFixed(2)} / ${quality.frameBudgetMs.toFixed(1)} ms`
            : '—'}
        </dd>

        <dt>Quality</dt>
        <dd>
          {quality
            ? `step ${quality.qualityStep + 1}/${quality.qualityStepCount} (${quality.adaptation})`
            : '—'}
        </dd>

        <dt>Preset</dt>
        <dd
          className="stims-shell__debug-hud-ellipsis"
          title={activePresetId ?? ''}
        >
          {activePresetId ?? '—'}
        </dd>

        <dt>Audio</dt>
        <dd>
          <span className="stims-shell__debug-hud-meter">
            <span
              className="stims-shell__debug-hud-meter-fill"
              style={{ width: `${energyPercent}%` }}
            />
          </span>
          <span className="stims-shell__debug-hud-meter-value">
            {engineSnapshot?.audioActive ? audioEnergy.toFixed(3) : 'idle'}
          </span>
        </dd>
      </dl>

      <section className="stims-shell__debug-hud-section">
        <h2 className="stims-shell__debug-hud-heading">Shader lowering</h2>
        {lowering ? (
          <dl className="stims-shell__debug-hud-grid">
            {lowering.noCustomShaders ? (
              <>
                <dt>Shaders</dt>
                <dd>none authored</dd>
              </>
            ) : (
              <>
                <dt>Warp</dt>
                <dd
                  className={
                    lowering.warp === 'approximated'
                      ? 'stims-shell__debug-hud-warn'
                      : undefined
                  }
                >
                  {lowering.warp}
                </dd>
                <dt>Comp</dt>
                <dd
                  className={
                    lowering.comp === 'approximated'
                      ? 'stims-shell__debug-hud-warn'
                      : undefined
                  }
                >
                  {lowering.comp}
                </dd>
                <dt>Approximated</dt>
                <dd
                  className={
                    lowering.unsupportedLines > 0
                      ? 'stims-shell__debug-hud-warn'
                      : undefined
                  }
                >
                  {lowering.unsupportedLines} lines
                </dd>
              </>
            )}
            {/* The rows above answer "did the compiler lower this preset's
                shader text?", which is not the same question as "is the
                backend running it?". A preset can lower cleanly and still be
                approximated at render time, because lowering and per-backend
                executability are decided separately — so the HUD used to read
                "lowered" over a frame that was a uniform-only substitution.
                This row is the render-time answer. */}
            <dt>On {engineSnapshot?.backend ?? '—'}</dt>
            <dd
              className={
                isShaderApproximated(shaderExecution)
                  ? 'stims-shell__debug-hud-warn'
                  : undefined
              }
            >
              {shaderExecution ?? '—'}
            </dd>
            <dt>Diagnostics</dt>
            <dd
              className={
                lowering.errors > 0 ? 'stims-shell__debug-hud-warn' : undefined
              }
            >
              {lowering.errors} err / {lowering.warnings} warn
            </dd>
          </dl>
        ) : (
          <p className="stims-shell__debug-hud-empty">Waiting for engine…</p>
        )}
      </section>

      <section className="stims-shell__debug-hud-section">
        <h2 className="stims-shell__debug-hud-heading">
          Uniforms
          <span className="stims-shell__debug-hud-note">
            authored base values, pre per_frame
          </span>
        </h2>
        {numericFields ? (
          <dl className="stims-shell__debug-hud-grid stims-shell__debug-hud-grid--uniforms">
            {TRACKED_UNIFORMS.map((name) => (
              <div key={name} className="stims-shell__debug-hud-uniform">
                <dt>{name}</dt>
                <dd>{formatUniform(numericFields[name])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="stims-shell__debug-hud-empty">Waiting for engine…</p>
        )}
      </section>
    </aside>
  );
}
