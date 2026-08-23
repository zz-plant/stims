import type { AnimationContext } from './animation-loop';
import { getContextFrequencyData, virtualTimeSource } from './animation-loop';
import type { AudioInitOptions, FrequencyAnalyser } from './audio-handler';
import { createFrameGate } from './frame-pacing';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
  subscribeToPerformanceSettings,
} from './performance-panel';
import { getPowerSavingFrameCapHz } from './power-state';
import {
  fillReferenceAudioWaveform,
  REFERENCE_AUDIO_STEADY_BAND,
} from './testing/reference-audio.ts';
import {
  generateStimulusFrame,
  type StimulusSpec,
} from './testing/synthetic-stimulus.ts';

/** projectM's converged bands for the reference tone signal. */
const REFERENCE_AUDIO_BANDS = {
  bass: REFERENCE_AUDIO_STEADY_BAND,
  mid: REFERENCE_AUDIO_STEADY_BAND,
  treble: REFERENCE_AUDIO_STEADY_BAND,
} as const;

import {
  resolveToyAudioOptions,
  startToyAudio,
  type ToyAudioRequest,
} from './toy-audio';
import { registerToyGlobals } from './toy-globals';
import type { ToyInstance } from './toy-interface';
import {
  createUnifiedInput,
  type UnifiedInputOptions,
  type UnifiedInputState,
} from './unified-input';
import WebToy, { type WebToyOptions } from './web-toy';

const EMPTY_UINT8 = new Uint8Array(0);

// Touch/mobile detection is static per session; evaluating the UA regex
// inside the preview tick put it on the pre-audio hot path for no reason.
// Mobile throttles the synthetic preview data to 30Hz; desktop runs every tick.
const PREVIEW_DATA_INTERVAL_MS =
  typeof navigator !== 'undefined' &&
  ((navigator.maxTouchPoints ?? 0) > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? ''))
    ? 1000 / 30
    : 0;

export type ToyRuntimeFrame = {
  toy: WebToy;
  time: number;
  deltaMs: number;
  realTimeMs: number;
  analyser: FrequencyAnalyser | null;
  frequencyData: Uint8Array;
  waveformData: Uint8Array;
  input: UnifiedInputState | null;
  performance: PerformanceSettings;
  /**
   * Relationship lock flag for the current frame: pins preset-facing
   * time/frame signals so the audio->visual mapping stays put while audio
   * keeps driving output. Set by `renderFrames({ relationshipLock })`.
   */
  relationshipLock?: boolean;
  /**
   * One-shot: this frame starts a deterministic capture, so anything holding
   * history from before it (feedback buffers) must be dropped. Harness-only —
   * `renderFrames({ startTime })` sets it; a live session never does.
   */
  resetHistory?: boolean;
  /**
   * Capture-only: replace the analyser-derived MilkDrop bands for this frame.
   *
   * The parity harness pins these to projectM's converged values for the
   * reference signal, so the two renderers run the preset equations on
   * identical audio instead of on two different normalisations of it. A live
   * session never sets it.
   */
  bandOverride?: { bass: number; mid: number; treble: number };
};

export type ToyRuntimePlugin = {
  name?: string;
  setup?: (runtime: ToyRuntimeInstance) => void;
  update?: (frame: ToyRuntimeFrame) => void;
  onInput?: (state: UnifiedInputState, frame: ToyRuntimeFrame) => void;
  onPerformanceChange?: (
    settings: PerformanceSettings,
    runtime: ToyRuntimeInstance,
  ) => void;
  dispose?: () => void;
};

export type ToyRuntimeOptions = {
  container?: HTMLElement | null;
  canvas?: HTMLCanvasElement | null;
  toyOptions?: WebToyOptions;
  audio?: {
    fftSize?: number;
    options?: AudioInitOptions;
  };
  preview?: {
    enabled?: boolean;
    fftBins?: number;
  };
  input?: Partial<Omit<UnifiedInputOptions, 'target'>> & {
    enabled?: boolean;
    target?: HTMLElement | null;
    touchAction?: 'none' | 'manipulation' | 'auto';
  };
  performance?: {
    enabled?: boolean;
    storageKey?: string;
    applyRendererSettings?: boolean;
  };
  plugins?: ToyRuntimePlugin[];
};

export type ToyRuntimeInstance = ToyInstance & {
  toy: WebToy;
  startAudio: (request?: ToyAudioRequest) => Promise<AnimationContext>;
  stopAudio: () => void;
  /** Pause the idle preview loop to free the main thread. */
  pausePreview?: () => void;
  /** Resume the idle preview loop. */
  resumePreview?: () => void;
  /**
   * Synchronously pump N frames through the plugin pipeline with synthetic
   * time and audio data, decoupling simulation time from wall-clock time.
   * Built for headless capture harnesses: presets that need seconds of
   * feedback accumulation render in however long the GPU takes, and the
   * synthetic signal is a pure function of frame time so captures are
   * reproducible. Only valid while audio is inactive (the audio loop would
   * double-drive the pipeline); returns null in that case.
   */
  renderFrames?: (options?: {
    frames?: number;
    deltaMs?: number;
    /**
     * Start the simulation clock here before pumping, in seconds. Only for
     * harnesses that need byte-comparable frames; a live session must not use
     * it, since jumping `time` backwards is visible in any preset that reads
     * it.
     */
    startTime?: number;
    /**
     * Overlay a deterministic 2Hz beat envelope on the synthetic signal.
     * The idle preview signal is smooth sines with no transients, so
     * beat-gated visuals never fire under it; captures that want them
     * lit opt into pulsed energy. Ignored when `stimulus` is set.
     */
    beatPulse?: boolean;
    /**
     * Replace the synthetic signal entirely with a controlled, known
     * profile (flat/ramp/transient/band) for audio->visual transfer
     * characterization — see `testing/synthetic-stimulus.ts` and
     * `scripts/analyze-preset-audio-response.ts`. When set, the decorative
     * idle-preview wave and `beatPulse` are both bypassed for every frame
     * of this call, so the driving signal is exactly what the spec
     * describes and nothing else.
     */
    stimulus?: {
      spec: StimulusSpec;
      /**
       * Frame index within the *full* stimulus timeline that this call's
       * first frame represents. A caller driving the stimulus one frame at
       * a time (to read pixels back between frames) must pass its own
       * running counter here — without it, every single-frame call would
       * see itself as frame 0 of a 1-frame timeline, collapsing a ramp or
       * transient to a single fixed value. Defaults to 0.
       */
      frameOffset?: number;
      /**
       * Length of the full stimulus timeline, which may exceed this call's
       * own `frames` when driving it incrementally. Defaults to this
       * call's `frames` — correct when one call renders one whole trial.
       */
      totalFrames?: number;
    };
    /**
     * Drive the pump with the audio a projectM parity reference was rendered
     * against, instead of the decorative synthetic signal.
     *
     * `tones` feeds the exact samples the C++ harness feeds projectM
     * (`core/testing/reference-audio.ts`) and pins the preset-facing bands to
     * that signal's analytic steady state, so both renderers see identical
     * audio. `silence` is digital silence: every frequency bin 0 and every
     * waveform sample at the 128 centre line — note the centre, since zeroing
     * the waveform buffer reads as a full-negative DC offset, not silence.
     *
     * Silence is not a neutral input. The default synthetic signal is a sine
     * spectrum in the range 12..232 that reads as loud music (measured on a
     * capture: bass 0.60 / mid 0.39 / treb 0.32), while projectM's beat
     * detector divides by `fmax(0.0001, ...)` and lands silence on
     * bass = mid = treb = 0. Pick the one the reference used.
     */
    referenceAudio?: 'silence' | 'tones';
    /**
     * Pin the preset-facing `time` and `frame` signals at their first-locked
     * values while the internal audio-analysis clock keeps running — the
     * "relationship lock" for docs/SENSORY_ACCESSIBILITY.md. The audio->visual
     * mapping (time/frame-driven terms) stays put; audio still drives output.
     * Only meaningful for the deterministic `renderFrames` path.
     */
    relationshipLock?: boolean;
  }) => { rendered: number } | null;
  addPlugin: (plugin: ToyRuntimePlugin) => void;
  getInputState: () => UnifiedInputState | null;
  getPerformanceSettings: () => PerformanceSettings;
};

type ToyRuntimePluginManager = {
  add: (plugin: ToyRuntimePlugin) => void;
  setupAll: (runtime: ToyRuntimeInstance) => void;
  update: (frame: ToyRuntimeFrame) => void;
  onInput: (state: UnifiedInputState, frame: ToyRuntimeFrame) => void;
  onPerformanceChange: (
    settings: PerformanceSettings,
    runtime: ToyRuntimeInstance,
  ) => void;
  dispose: () => void;
};

type PerformanceController = {
  getSettings: () => PerformanceSettings;
  applySettings: (settings: PerformanceSettings) => void;
  dispose: () => void;
};

type InputController = {
  getState: () => UnifiedInputState | null;
  dispose: () => void;
};

const defaultInputOptions = (
  target: HTMLElement,
  overrides?: ToyRuntimeOptions['input'],
): UnifiedInputOptions => ({
  target,
  boundsElement: overrides?.boundsElement,
  onInput: overrides?.onInput,
  keyboardEnabled: overrides?.keyboardEnabled,
  gamepadEnabled: overrides?.gamepadEnabled,
  keyboardSpeed: overrides?.keyboardSpeed,
  keyboardBoost: overrides?.keyboardBoost,
  gamepadSpeed: overrides?.gamepadSpeed,
  gamepadDeadzone: overrides?.gamepadDeadzone,
  focusOnPress: overrides?.focusOnPress,
  micProvider: overrides?.micProvider,
});

const createPluginManager = (
  initialPlugins: ToyRuntimePlugin[],
): ToyRuntimePluginManager => {
  const plugins = [...initialPlugins];

  return {
    add: (plugin) => {
      plugins.push(plugin);
    },
    setupAll: (runtime) => {
      plugins.forEach((plugin) => plugin.setup?.(runtime));
    },
    update: (frame) => {
      plugins.forEach((plugin) => plugin.update?.(frame));
    },
    onInput: (state, frame) => {
      plugins.forEach((plugin) => plugin.onInput?.(state, frame));
    },
    onPerformanceChange: (settings, runtime) => {
      plugins.forEach((plugin) =>
        plugin.onPerformanceChange?.(settings, runtime),
      );
    },
    dispose: () => {
      plugins.forEach((plugin) => plugin.dispose?.());
    },
  };
};

const createPerformanceController = ({
  toy,
  options,
  onChange,
}: {
  toy: WebToy;
  options?: ToyRuntimeOptions['performance'];
  onChange?: (settings: PerformanceSettings) => void;
}): PerformanceController => {
  const applyRendererSettings = options?.applyRendererSettings !== false;
  let settings = getActivePerformanceSettings({
    storageKey: options?.storageKey,
  });

  if (applyRendererSettings) {
    toy.updateRendererSettings({ maxPixelRatio: settings.maxPixelRatio });
  }

  const applySettings = (nextSettings: PerformanceSettings) => {
    settings = nextSettings;
    if (applyRendererSettings) {
      toy.updateRendererSettings({ maxPixelRatio: nextSettings.maxPixelRatio });
    }
    onChange?.(nextSettings);
  };

  const unsubscribe =
    options?.enabled === false
      ? null
      : subscribeToPerformanceSettings(applySettings);

  return {
    getSettings: () => settings,
    applySettings,
    dispose: () => {
      unsubscribe?.();
    },
  };
};

const createInputController = ({
  toy,
  options,
  onInput,
  getMicLevel,
}: {
  toy: WebToy;
  options?: ToyRuntimeOptions['input'];
  onInput: (state: UnifiedInputState) => void;
  getMicLevel: () => { level: number; available: boolean };
}): InputController => {
  let inputState: UnifiedInputState | null = null;

  const inputTarget =
    options?.enabled === false
      ? null
      : (options?.target ??
        (toy.canvas instanceof HTMLElement ? toy.canvas : null) ??
        toy.container);

  const resolvedTouchAction =
    options?.touchAction ??
    (inputTarget === toy.canvas && inputTarget instanceof HTMLElement
      ? 'none'
      : undefined);

  if (inputTarget instanceof HTMLElement && resolvedTouchAction) {
    inputTarget.style.touchAction = resolvedTouchAction;
  }

  const inputAdapter =
    inputTarget && inputTarget instanceof HTMLElement
      ? createUnifiedInput({
          ...defaultInputOptions(inputTarget, options),
          onInput: (state) => {
            inputState = state;
            onInput(state);
            options?.onInput?.(state);
          },
          micProvider: getMicLevel,
        })
      : null;

  return {
    getState: () => inputState,
    dispose: () => {
      inputAdapter?.dispose();
    },
  };
};

export function createToyRuntime({
  container = null,
  canvas = null,
  toyOptions,
  audio,
  preview,
  input,
  performance,
  plugins = [],
}: ToyRuntimeOptions = {}): ToyRuntimeInstance {
  const toy = new WebToy({
    ...toyOptions,
    container,
    canvas,
  });
  let analyser: FrequencyAnalyser | null = null;
  let lastFrameTime = 0;
  const pluginManager = createPluginManager(plugins);
  let runtime: ToyRuntimeInstance | null = null;

  const performanceController = createPerformanceController({
    toy,
    options: performance,
    onChange: (settings) => {
      if (runtime) {
        pluginManager.onPerformanceChange(
          settings,
          runtime as ToyRuntimeInstance,
        );
      }
    },
  });

  const frameState: ToyRuntimeFrame = {
    toy,
    time: 0,
    deltaMs: 0,
    realTimeMs: 0,
    analyser: null,
    frequencyData: new Uint8Array(0),
    waveformData: new Uint8Array(0),
    input: null,
    performance: performanceController.getSettings(),
    relationshipLock: false,
  };

  const inputController = createInputController({
    toy,
    options: input,
    onInput: (state) => {
      pluginManager.onInput(state, frameState);
    },
    getMicLevel: () => ({
      level: analyser?.getRmsLevel() ?? 0,
      available: Boolean(analyser),
    }),
  });

  const previewOptions = {
    enabled: true,
    fftBins: 512,
    ...preview,
  };
  const previewFrequencyData = new Uint8Array(previewOptions.fftBins);
  const previewWaveformData = new Uint8Array(previewOptions.fftBins);
  let previewAnimationId: number | null = null;
  let previewActive = false;
  let previewStart = 0;
  let previewLastFrame = 0;
  let previewLastDataUpdate = -Infinity;
  let previewVisibilityCleanup: (() => void) | null = null;

  const updatePreviewFrequencyData = (time: number) => {
    for (let i = 0; i < previewFrequencyData.length; i += 1) {
      const normalized = i / previewFrequencyData.length;
      const wave =
        (Math.sin(time * (0.9 + normalized) + normalized * 6.2) +
          Math.sin(time * 1.7 + normalized * 10.5) * 0.4 +
          Math.cos(time * 0.6 + normalized * 3.1) * 0.3) /
        1.7;
      const envelope = 0.4 + Math.sin(time * 0.45 + normalized * 4) * 0.35;
      const shimmer = Math.sin(time * 3.5 + normalized * 40) * 0.12;
      const value = Math.max(
        0,
        Math.min(1, (wave * 0.5 + 0.5) * (0.6 + envelope) + shimmer),
      );
      previewFrequencyData[i] = Math.round(value * 220 + 12);
      previewWaveformData[i] = Math.round(
        Math.max(
          0,
          Math.min(
            255,
            128 +
              (Math.sin(time * 3.2 + normalized * Math.PI * 6) * 0.55 +
                Math.sin(time * 1.4 + normalized * Math.PI * 2) * 0.25) *
                96,
          ),
        ),
      );
    }
  };

  const stopPreviewLoop = () => {
    if (!previewActive) return;
    previewActive = false;
    if (previewAnimationId !== null) {
      cancelAnimationFrame(previewAnimationId);
      previewAnimationId = null;
    }
  };

  const startPreviewLoop = () => {
    if (
      !previewOptions.enabled ||
      previewActive ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    previewActive = true;
    const timeSource = virtualTimeSource
      ? { now: virtualTimeSource }
      : (globalThis.performance ?? { now: () => Date.now() });
    previewStart = timeSource.now();
    previewLastFrame = previewStart;
    let failureStreak = 0;

    let smoothedPreviewDeltaMs = 0;
    // The pre-audio preview runs before the user has done anything, so it is the
    // loop most likely to be left burning battery on a page nobody is watching.
    const previewFrameGate = createFrameGate(getPowerSavingFrameCapHz);
    const tick = (now: number) => {
      if (!previewActive) return;
      const currentTime = virtualTimeSource ? virtualTimeSource() : now;
      if (!previewFrameGate.shouldRenderFrame(currentTime)) {
        previewAnimationId = requestAnimationFrame(tick);
        return;
      }
      const rawDeltaMs = previewLastFrame
        ? Math.min(100, Math.max(0, currentTime - previewLastFrame))
        : 1000 / 60;
      previewLastFrame = currentTime;
      smoothedPreviewDeltaMs = smoothedPreviewDeltaMs
        ? smoothedPreviewDeltaMs * 0.85 + rawDeltaMs * 0.15
        : rawDeltaMs;
      frameState.deltaMs = smoothedPreviewDeltaMs;
      frameState.time += smoothedPreviewDeltaMs / 1000;
      frameState.realTimeMs = currentTime;
      frameState.analyser = null;
      const previewDataIntervalMs = PREVIEW_DATA_INTERVAL_MS;
      if (now - previewLastDataUpdate >= previewDataIntervalMs) {
        updatePreviewFrequencyData(frameState.time);
        previewLastDataUpdate = now;
      }
      frameState.frequencyData = previewFrequencyData;
      frameState.waveformData = previewWaveformData;
      frameState.input = inputController.getState();
      frameState.performance = performanceController.getSettings();
      // A throwing plugin must not freeze the pre-audio preview — skip the
      // frame and keep the loop alive unless the failure is sustained.
      try {
        pluginManager.update(frameState);
        failureStreak = 0;
      } catch (error) {
        failureStreak += 1;
        if (failureStreak === 1) {
          console.warn('[stims] Preview frame failed; continuing.', error);
        }
        if (failureStreak >= 60) {
          console.error(
            '[stims] Preview loop stopped after repeated frame failures.',
            error,
          );
          stopPreviewLoop();
          return;
        }
      }
      previewAnimationId = requestAnimationFrame(tick);
    };

    previewAnimationId = requestAnimationFrame(tick);
  };

  if (typeof document !== 'undefined') {
    const handlePreviewVisibilityChange = () => {
      if (document.hidden) {
        stopPreviewLoop();
        return;
      }
      if (!analyser) {
        startPreviewLoop();
      }
    };
    document.addEventListener(
      'visibilitychange',
      handlePreviewVisibilityChange,
    );
    previewVisibilityCleanup = () => {
      document.removeEventListener(
        'visibilitychange',
        handlePreviewVisibilityChange,
      );
    };
  }

  const startAudio = async (request?: ToyAudioRequest) => {
    let smoothedAudioDeltaMs = 0;
    const context = await startToyAudio(
      toy,
      (ctx) => {
        analyser = ctx.analyser;
        const now = ctx.time;
        const rawDeltaMs = lastFrameTime
          ? Math.min(100, Math.max(0, (now - lastFrameTime) * 1000))
          : 1000 / 60;
        lastFrameTime = now;
        smoothedAudioDeltaMs = smoothedAudioDeltaMs
          ? smoothedAudioDeltaMs * 0.85 + rawDeltaMs * 0.15
          : rawDeltaMs;
        frameState.deltaMs = smoothedAudioDeltaMs;
        frameState.time += smoothedAudioDeltaMs / 1000;
        frameState.realTimeMs = ctx.realTimeMs;
        frameState.analyser = analyser;
        frameState.frequencyData = getContextFrequencyData(ctx);
        frameState.waveformData = analyser?.getWaveformData() ?? EMPTY_UINT8;
        frameState.input = inputController.getState();
        frameState.performance = performanceController.getSettings();
        pluginManager.update(frameState);
      },
      resolveToyAudioOptions(request, {
        fftSize: audio?.fftSize,
        ...audio?.options,
      }),
    );
    stopPreviewLoop();
    return context;
  };

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  runtime = {
    toy,
    startAudio,
    stopAudio: () => {
      toy.stopAudio();
      analyser = null;
      lastFrameTime = 0;
      startPreviewLoop();
    },
    pausePreview: stopPreviewLoop,
    resumePreview: startPreviewLoop,
    renderFrames: (options) => {
      const frames = Math.max(1, Math.floor(options?.frames ?? 1));
      const deltaMs = options?.deltaMs ?? 1000 / 60;
      const beatPulse = options?.beatPulse ?? false;
      const stimulus = options?.stimulus;
      const referenceAudio = options?.referenceAudio;
      const silentAudio = referenceAudio === 'silence';
      const relationshipLock = options?.relationshipLock ?? false;
      if (silentAudio && !stimulus) {
        previewFrequencyData.fill(0);
        previewWaveformData.fill(128);
      }
      let resetHistoryOnNextFrame = false;
      stopPreviewLoop();
      if (options?.startTime !== undefined) {
        // Pumped frames are only reproducible if the clock they integrate is
        // too. The idle signal is a pure function of frameState.time, and
        // presets read `time` directly, so starting from however many seconds
        // of wall clock happened to elapse before the pump made every capture
        // different: two consecutive captures of the same preset, same code,
        // differed on 4.2% of pixels — as large as the gap being measured.
        frameState.time = options.startTime;
        frameState.realTimeMs = options.startTime * 1000;
        resetHistoryOnNextFrame = true;
      }
      let rendered = 0;
      for (let i = 0; i < frames; i += 1) {
        frameState.resetHistory = resetHistoryOnNextFrame;
        resetHistoryOnNextFrame = false;
        frameState.time += deltaMs / 1000;
        frameState.deltaMs = deltaMs;
        frameState.realTimeMs += deltaMs;
        frameState.relationshipLock = relationshipLock;
        frameState.analyser = null;
        if (stimulus) {
          // A controlled, known signal replaces the decorative wave
          // entirely — transfer-characterization needs the driving input
          // to be exactly what the spec describes, with no unaccounted
          // component riding along underneath it.
          previewFrequencyData.set(
            generateStimulusFrame(
              stimulus.spec,
              (stimulus.frameOffset ?? 0) + i,
              stimulus.totalFrames ?? frames,
              previewFrequencyData.length,
            ),
          );
        } else if (referenceAudio === 'tones') {
          // The bands are pinned below rather than derived: our analyser
          // normalises a steady signal to 1.0 where projectM's converges to
          // 2/3, so deriving them would put the two renderers on different
          // audio while claiming to compare renders.
          fillReferenceAudioWaveform(previewWaveformData, i);
          frameState.bandOverride = REFERENCE_AUDIO_BANDS;
        } else if (!silentAudio) {
          updatePreviewFrequencyData(frameState.time);
          if (beatPulse) {
            // Sharp 2Hz spikes over a quiet floor, bass-weighted the way a
            // kick drum is — enough contrast for onset detectors to fire.
            const phase = Math.sin(Math.PI * 2 * frameState.time * 2);
            const spike = Math.max(0, phase) ** 8;
            for (let bin = 0; bin < previewFrequencyData.length; bin += 1) {
              const bassWeight = 1 - (bin / previewFrequencyData.length) * 0.6;
              const gain = 0.35 + 1.4 * spike * bassWeight;
              previewFrequencyData[bin] = Math.min(
                255,
                Math.round(previewFrequencyData[bin] * gain),
              );
            }
          }
        }
        frameState.frequencyData = previewFrequencyData;
        frameState.waveformData = previewWaveformData;
        frameState.input = inputController.getState();
        frameState.performance = performanceController.getSettings();
        pluginManager.update(frameState);
        rendered += 1;
      }
      return { rendered };
    },
    addPlugin: (plugin) => {
      pluginManager.add(plugin);
      plugin.setup?.(runtime as ToyRuntimeInstance);
    },
    getInputState: () => inputController.getState(),
    getPerformanceSettings: () => performanceController.getSettings(),
    dispose: () => {
      stopPreviewLoop();
      pluginManager.dispose();
      inputController.dispose();
      performanceController.dispose();
      previewVisibilityCleanup?.();
      unregisterGlobals();
      toy.dispose();
    },
  };

  pluginManager.setupAll(runtime as ToyRuntimeInstance);
  startPreviewLoop();

  return runtime as ToyRuntimeInstance;
}
