import {
  getActiveMotionPreference,
  setMotionPreference,
} from '../core/motion-preferences';
import {
  getActiveRenderPreferences,
  setRenderPreferences,
} from '../core/render-preferences';

type PartyModeOptions = {
  enabled: boolean;
};

const PARTY_MODE_KEY = 'stims:party-mode-enabled';
const PARTY_MODE_RESTORE_KEY = 'stims:party-mode-restore';

type PartyModeRestoreState = {
  motionEnabled: boolean;
  compatibilityMode: boolean;
  maxPixelRatio: number | null;
  renderScale: number | null;
};

function writePartyMode(enabled: boolean) {
  try {
    window.sessionStorage.setItem(PARTY_MODE_KEY, enabled ? 'true' : 'false');
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function isPartyModeEnabled() {
  try {
    return window.sessionStorage.getItem(PARTY_MODE_KEY) === 'true';
  } catch (_error) {
    return false;
  }
}

function writeRestoreState(state: PartyModeRestoreState | null) {
  try {
    if (state) {
      window.sessionStorage.setItem(
        PARTY_MODE_RESTORE_KEY,
        JSON.stringify(state),
      );
      return;
    }
    window.sessionStorage.removeItem(PARTY_MODE_RESTORE_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function readRestoreState(): PartyModeRestoreState | null {
  try {
    const raw = window.sessionStorage.getItem(PARTY_MODE_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      motionEnabled: parsed.motionEnabled !== false,
      compatibilityMode: parsed.compatibilityMode === true,
      maxPixelRatio:
        typeof parsed.maxPixelRatio === 'number' ? parsed.maxPixelRatio : null,
      renderScale:
        typeof parsed.renderScale === 'number' ? parsed.renderScale : null,
    };
  } catch (_error) {
    return null;
  }
}

export function applyPartyMode({ enabled }: PartyModeOptions) {
  writePartyMode(enabled);

  if (enabled) {
    const motionPreference = getActiveMotionPreference();
    const renderPreferences = getActiveRenderPreferences();
    writeRestoreState({
      motionEnabled: motionPreference.enabled,
      compatibilityMode: renderPreferences.compatibilityMode,
      maxPixelRatio: renderPreferences.maxPixelRatio,
      renderScale: renderPreferences.renderScale,
    });

    setMotionPreference({ enabled: true });
    setRenderPreferences({
      compatibilityMode: false,
      maxPixelRatio: 2.5,
      renderScale: 1.15,
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
    maxPixelRatio: restore.maxPixelRatio,
    renderScale: restore.renderScale,
  });
}
