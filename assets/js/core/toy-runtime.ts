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
    analyser: null,
    frequencyData: new Uint8Array(0),
    input: null,
    performance: performanceController.getSettings(),
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
        frameState.input = inputController.getState();
        frameState.performance = performanceController.getSettings();
        pluginManager.update(frameState);
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
      pluginManager.add(plugin);
      plugin.setup?.(runtime as ToyRuntimeInstance);
    },
    getInputState: () => inputController.getState(),
    getPerformanceSettings: () => performanceController.getSettings(),
    dispose: () => {
      pluginManager.dispose();
      inputController.dispose();
      performanceController.dispose();
      unregisterGlobals();
      toy.dispose();
    },
  };

  pluginManager.setupAll(runtime as ToyRuntimeInstance);

  return runtime as ToyRuntimeInstance;
}
