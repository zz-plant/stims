import { useEffect, useMemo, useState } from 'react';
import { parseURLParams } from '../core/url-params.ts';
import type { MilkdropCompiledPreset } from '../milkdrop/compiler-types.ts';
import { useEngine, useEngineSnapshot } from './engine-context.tsx';

/**
 * On-canvas debug HUD, mounted only for `?debug=hud`.
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

function useHudEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const debug = parseURLParams().flags.debug;
    setEnabled(debug === 'hud');
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
          ✕
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
