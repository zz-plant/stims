import type {
  AudioInitOptions,
  FrequencyAnalyser,
} from '../utils/audio-handler';
import type { ToyAudioRequest } from '../utils/audio-start';
import { resolveToyAudioOptions } from '../utils/audio-start';
import { startToyAudio } from '../utils/start-audio';
import {
  createUnifiedInput,
  type UnifiedInputOptions,
  type UnifiedInputState,
} from '../utils/unified-input';
import type { AnimationContext } from './animation-loop';
import { getContextFrequencyData } from './animation-loop';
import {
  getActivePerformanceSettings,
  type PerformanceSettings,
  subscribeToPerformanceSettings,
} from './performance-panel';
import { registerToyGlobals } from './toy-globals';
import type { ToyInstance } from './toy-interface';
import WebToy, { type WebToyOptions } from './web-toy';

export type ToyRuntimeFrame = {
  toy: WebToy;
  time: number;
  deltaMs: number;
  analyser: FrequencyAnalyser | null;
  frequencyData: Uint8Array;
  input: UnifiedInputState | null;
  performance: PerformanceSettings;
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
  addPlugin: (plugin: ToyRuntimePlugin) => void;
  getInputState: () => UnifiedInputState | null;
  getPerformanceSettings: () => PerformanceSettings;
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

export function createToyRuntime({
  container = null,
  canvas = null,
  toyOptions,
  audio,
  input,
  performance,
  plugins = [],
}: ToyRuntimeOptions = {}): ToyRuntimeInstance {
  const toy = new WebToy({
    ...toyOptions,
    container,
    canvas,
  });
  const runtimePlugins = [...plugins];
  let inputState: UnifiedInputState | null = null;
  let analyser: FrequencyAnalyser | null = null;
  let lastFrameTime = 0;
  let performanceSettings = getActivePerformanceSettings({
    storageKey: performance?.storageKey,
  });

  if (performance?.applyRendererSettings !== false) {
    toy.updateRendererSettings({
      maxPixelRatio: performanceSettings.maxPixelRatio,
    });
  }

  let runtime: ToyRuntimeInstance | null = null;

  const applyPerformanceSettings = (settings: PerformanceSettings) => {
    performanceSettings = settings;
    if (performance?.applyRendererSettings !== false) {
      toy.updateRendererSettings({ maxPixelRatio: settings.maxPixelRatio });
    }
    if (runtime) {
      runtimePlugins.forEach((plugin) =>
        plugin.onPerformanceChange?.(settings, runtime as ToyRuntimeInstance),
      );
    }
  };

  const performanceUnsubscribe =
    performance?.enabled === false
      ? null
      : subscribeToPerformanceSettings(applyPerformanceSettings);

  const inputTarget =
    input?.enabled === false
      ? null
      : (input?.target ??
        (toy.canvas instanceof HTMLElement ? toy.canvas : null) ??
        toy.container);

  const resolvedTouchAction =
    input?.touchAction ??
    (inputTarget === toy.canvas && inputTarget instanceof HTMLElement
      ? 'none'
      : undefined);

  if (inputTarget instanceof HTMLElement && resolvedTouchAction) {
    inputTarget.style.touchAction = resolvedTouchAction;
  }

  const inputAdapter =
    inputTarget && inputTarget instanceof HTMLElement
      ? createUnifiedInput({
          ...defaultInputOptions(inputTarget, input),
          onInput: (state) => {
            inputState = state;
            runtimePlugins.forEach((plugin) =>
              plugin.onInput?.(state, frameState),
            );
            input?.onInput?.(state);
          },
          micProvider: () => ({
            level: analyser?.getRmsLevel() ?? 0,
            available: Boolean(analyser),
          }),
        })
      : null;

  const frameState: ToyRuntimeFrame = {
    toy,
    time: 0,
    deltaMs: 0,
    analyser: null,
    frequencyData: new Uint8Array(0),
    input: null,
    performance: performanceSettings,
  };

  const startAudio = async (request?: ToyAudioRequest) => {
    return startToyAudio(
      toy,
      (ctx) => {
        analyser = ctx.analyser;
        const now = ctx.time;
        frameState.deltaMs = lastFrameTime ? (now - lastFrameTime) * 1000 : 0;
        lastFrameTime = now;
        frameState.time = now;
        frameState.analyser = analyser;
        frameState.frequencyData = getContextFrequencyData(ctx);
        frameState.input = inputState;
        frameState.performance = performanceSettings;
        runtimePlugins.forEach((plugin) => plugin.update?.(frameState));
      },
      resolveToyAudioOptions(request, {
        fftSize: audio?.fftSize,
        ...audio?.options,
      }),
    );
  };

  const unregisterGlobals = registerToyGlobals(container, startAudio);

  runtime = {
    toy,
    startAudio,
    addPlugin: (plugin) => {
      runtimePlugins.push(plugin);
      plugin.setup?.(runtime as ToyRuntimeInstance);
    },
    getInputState: () => inputState,
    getPerformanceSettings: () => performanceSettings,
    dispose: () => {
      runtimePlugins.forEach((plugin) => plugin.dispose?.());
      inputAdapter?.dispose();
      performanceUnsubscribe?.();
      unregisterGlobals();
      toy.dispose();
    },
  };

  runtimePlugins.forEach((plugin) =>
    plugin.setup?.(runtime as ToyRuntimeInstance),
  );

  return runtime as ToyRuntimeInstance;
}
