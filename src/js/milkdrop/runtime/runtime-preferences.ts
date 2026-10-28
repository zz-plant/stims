import {
  isRoomModeRequested,
  ROOM_BLEND_SECONDS,
} from '../../core/room-mode.ts';
import { readUiPrefs, type UiPrefs, writeUiPrefs } from './persistence';

export function createMilkdropRuntimePreferences() {
  // A room display shuffles on its own and changes by slow dissolve, but
  // only for this visit: the saved playback choices stay as they were. It
  // opens on the first-run preset, which is measured not to flash, rather
  // than on whatever this computer's last visitor played.
  const room = isRoomModeRequested();
  const prefs: UiPrefs = room
    ? {
        ...readUiPrefs(),
        lastPresetId: undefined,
        autoplay: true,
        blendDuration: ROOM_BLEND_SECONDS,
        transitionMode: 'blend',
      }
    : readUiPrefs();
  const save = (update: Partial<UiPrefs>) => {
    if (!room) writeUiPrefs(update);
  };

  return {
    getAutoplay: () => prefs.autoplay ?? false,
    setAutoplay(enabled: boolean) {
      prefs.autoplay = enabled;
      save({ autoplay: enabled });
    },
    getBlendDuration(defaultValue: number) {
      return prefs.blendDuration ?? defaultValue;
    },
    setBlendDuration(value: number) {
      prefs.blendDuration = value;
      save({ blendDuration: value });
    },
    getTransitionMode: () => prefs.transitionMode ?? 'blend',
    setTransitionMode(mode: 'blend' | 'cut') {
      prefs.transitionMode = mode;
      save({ transitionMode: mode });
    },
    getStartupPresetId(initialPresetId?: string) {
      return initialPresetId ?? prefs.lastPresetId;
    },
    rememberLastPreset(id: string) {
      prefs.lastPresetId = id;
      // A room's last preset would greet the next visitor on this computer
      // as their own "Welcome back".
      save({ lastPresetId: id });
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
