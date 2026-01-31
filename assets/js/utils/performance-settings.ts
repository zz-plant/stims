import {
  getActivePerformanceSettings,
  type PerformanceSettings,
  subscribeToPerformanceSettings,
} from '../core/performance-panel';

export type PerformanceSettingsHandler = {
  getSettings: () => PerformanceSettings;
  dispose: () => void;
};

type PerformanceSettingsHandlerOptions = {
  onChange?: (settings: PerformanceSettings) => void;
  applyRendererSettings?: (settings: PerformanceSettings) => void;
  enabled?: boolean;
};

export function createPerformanceSettingsHandler({
  onChange,
  applyRendererSettings,
  enabled = true,
}: PerformanceSettingsHandlerOptions): PerformanceSettingsHandler {
  let settings = getActivePerformanceSettings();

  const applySettings = (next: PerformanceSettings) => {
    settings = next;
    applyRendererSettings?.(next);
    onChange?.(next);
  };

  applyRendererSettings?.(settings);

  const unsubscribe = enabled
    ? subscribeToPerformanceSettings(applySettings)
    : null;

  return {
    getSettings: () => settings,
    dispose: () => {
      unsubscribe?.();
    },
  };
}
