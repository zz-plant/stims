import { readUiPrefs, writeUiPrefs } from './persistence';

export function createMilkdropRuntimePreferences() {
  const prefs = readUiPrefs();

  return {
    getAutoplay: () => prefs.autoplay ?? false,
    setAutoplay(enabled: boolean) {
      prefs.autoplay = enabled;
      writeUiPrefs({ autoplay: enabled });
    },
    getBlendDuration(defaultValue: number) {
      return prefs.blendDuration ?? defaultValue;
    },
    setBlendDuration(value: number) {
      prefs.blendDuration = value;
      writeUiPrefs({ blendDuration: value });
    },
    getTransitionMode: () => prefs.transitionMode ?? 'blend',
    setTransitionMode(mode: 'blend' | 'cut') {
      prefs.transitionMode = mode;
      writeUiPrefs({ transitionMode: mode });
    },
    getStartupPresetId(initialPresetId?: string) {
      return initialPresetId ?? prefs.lastPresetId;
    },
    rememberLastPreset(id: string) {
      prefs.lastPresetId = id;
      writeUiPrefs({ lastPresetId: id });
    },
    recordFallback({ presetId, reason }: { presetId: string; reason: string }) {
      prefs.lastPresetId = presetId;
      prefs.fallbackNotice = reason;
      writeUiPrefs({
        lastPresetId: presetId,
        fallbackNotice: reason,
      });
    },
    consumeFallbackNotice() {
      const notice = prefs.fallbackNotice;
      if (!notice) {
        return null;
      }
      delete prefs.fallbackNotice;
      writeUiPrefs({ fallbackNotice: undefined });
      return notice;
    },
  };
}
