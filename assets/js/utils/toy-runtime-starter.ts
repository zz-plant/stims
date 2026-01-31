import {
  getPerformancePanel,
  type PerformancePanelOptions,
} from '../core/performance-panel';
import {
  createToyRuntime,
  type ToyRuntimeOptions,
  type ToyRuntimePlugin,
} from '../core/toy-runtime';
import {
  configureToySettingsPanel,
  type QualityPresetManager,
} from './toy-settings';

type ToyRuntimeStarterSettings = {
  title: string;
  description?: string;
  quality?: QualityPresetManager;
};

export type ToyRuntimeStarterOptions = Omit<
  ToyRuntimeOptions,
  'container' | 'canvas'
> & {
  canvasSelector?: string;
  boundsSelector?: string;
  settingsPanel?: ToyRuntimeStarterSettings;
};

export type AudioToyStarterOptions = Omit<
  ToyRuntimeStarterOptions,
  'plugins'
> & {
  plugins?: ToyRuntimePlugin[];
  performancePanel?: PerformancePanelOptions;
};

export function createToyRuntimeStarter({
  canvasSelector = 'canvas',
  boundsSelector = 'canvas',
  settingsPanel,
  input,
  ...runtimeOptions
}: ToyRuntimeStarterOptions) {
  return function start({
    container,
  }: {
    container?: HTMLElement | null;
  } = {}) {
    const canvas =
      container?.querySelector<HTMLCanvasElement>(canvasSelector) ?? undefined;
    const boundsElement =
      input?.boundsElement ??
      container?.querySelector<HTMLElement>(boundsSelector);
    const resolvedInput = input
      ? {
          ...input,
          boundsElement: boundsElement ?? undefined,
        }
      : undefined;

    const runtime = createToyRuntime({
      ...runtimeOptions,
      container,
      canvas,
      input: resolvedInput,
    });

    if (settingsPanel) {
      configureToySettingsPanel(settingsPanel);
    }

    return runtime;
  };
}

export function createAudioToyStarter({
  plugins = [],
  performancePanel,
  ...options
}: AudioToyStarterOptions) {
  const startRuntime = createToyRuntimeStarter({
    ...options,
    plugins,
  });

  return function start({
    container,
  }: {
    container?: HTMLElement | null;
  } = {}) {
    if (performancePanel) {
      getPerformancePanel(performancePanel);
    }

    return startRuntime({ container });
  };
}
