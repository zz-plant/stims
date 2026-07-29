import {
  getActiveMotionPreference,
  setMotionPreference,
} from './motion-preferences';
import {
  getActiveRenderPreferences,
  setRenderPreferences,
} from './render-preferences';

type PartyModeOptions = {
  enabled: boolean;
};

const PARTY_MODE_KEY = 'stims:party-mode-enabled';
const PARTY_MODE_RESTORE_KEY = 'stims:party-mode-restore';

type PartyModeRestoreState = {
  motionEnabled: boolean;
  compatibilityMode: boolean;
};

import { getBrowserSessionStorage } from './state/browser-storage.ts';

function writePartyMode(enabled: boolean) {
  const storage = getBrowserSessionStorage();
  if (!storage) return;
  storage.setItem(PARTY_MODE_KEY, enabled ? 'true' : 'false');
}

export function isPartyModeEnabled() {
  return getBrowserSessionStorage()?.getItem(PARTY_MODE_KEY) === 'true';
}

function hasRestoreState() {
  return getBrowserSessionStorage()?.getItem(PARTY_MODE_RESTORE_KEY) !== null;
}

function writeRestoreState(state: PartyModeRestoreState | null) {
  const storage = getBrowserSessionStorage();
  if (!storage) return;
  if (state) {
    storage.setItem(PARTY_MODE_RESTORE_KEY, JSON.stringify(state));
    return;
  }
  storage.removeItem(PARTY_MODE_RESTORE_KEY);
}

function readRestoreState(): PartyModeRestoreState | null {
  const raw = getBrowserSessionStorage()?.getItem(PARTY_MODE_RESTORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.motionEnabled === 'boolean' &&
      typeof parsed.compatibilityMode === 'boolean'
    ) {
      return parsed as PartyModeRestoreState;
    }
  } catch (_error) {
    // Return null if JSON is corrupt
  }
  return null;
}

export function applyPartyMode({ enabled }: PartyModeOptions) {
  writePartyMode(enabled);

  if (enabled) {
    if (!hasRestoreState()) {
      const motionPreference = getActiveMotionPreference();
      const renderPreferences = getActiveRenderPreferences();
      writeRestoreState({
        motionEnabled: motionPreference.enabled,
        compatibilityMode: renderPreferences.compatibilityMode,
      });
    }

    setMotionPreference({ enabled: true });
    setRenderPreferences({
      compatibilityMode: false,
    });
    return;
  }

  const restore = readRestoreState();
  writeRestoreState(null);
  if (!restore) {
    return;
  }

  setMotionPreference({ enabled: restore.motionEnabled });
  setRenderPreferences({
    compatibilityMode: restore.compatibilityMode,
  });
}
