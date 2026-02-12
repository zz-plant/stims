import { setMotionPreference } from '../core/motion-preferences';
import { setRenderPreferences } from '../core/render-preferences';

type PartyModeOptions = {
  enabled: boolean;
};

const PARTY_MODE_KEY = 'stims:party-mode-enabled';

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

export function applyPartyMode({ enabled }: PartyModeOptions) {
  writePartyMode(enabled);

  if (enabled) {
    setMotionPreference({ enabled: true });
    setRenderPreferences({
      compatibilityMode: false,
      maxPixelRatio: 2.5,
      renderScale: 1.15,
    });
    return;
  }

  setRenderPreferences({
    maxPixelRatio: null,
    renderScale: null,
  });
}
