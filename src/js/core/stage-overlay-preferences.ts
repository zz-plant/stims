/**
 * Stage overlay preference store.
 *
 * Two on-canvas overlays — the Strudel live-coding lab and the debug HUD —
 * were only reachable through URL flags (`?strudel=1`, `?debug=hud`/`?stats=1`),
 * so a visitor had to know the flag existed before they could ever turn the
 * surface on. This store is the Settings-side control for both, persisting the
 * choice the same way the theme store does and notifying subscribers so the
 * overlays mount/unmount without a reload.
 *
 * The HUD reuses the existing `stims:debug:hud` key ('1'/'0') so the retired
 * `?stats=1` spelling and this toggle share one persisted switch. The Strudel
 * lab has no prior persistence (it was a pure prototype flag), so it gets its
 * own key.
 */

export type StageOverlayPreferences = {
  strudelLab: boolean;
  debugHud: boolean;
};

type StageOverlaySubscriber = (preference: StageOverlayPreferences) => void;

const STRUDEL_KEY = 'stims:overlay:strudel';
export const DEBUG_HUD_KEY = 'stims:debug:hud';

const subscribers = new Set<StageOverlaySubscriber>();
let activePreference: StageOverlayPreferences | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readFromStorage(): StageOverlayPreferences {
  try {
    const storage = getStorage();
    const isOn = (value: string | null | undefined) =>
      value === '1' || value === 'true';
    return {
      strudelLab: isOn(storage?.getItem(STRUDEL_KEY)),
      debugHud: isOn(storage?.getItem(DEBUG_HUD_KEY)),
    };
  } catch {
    return { strudelLab: false, debugHud: false };
  }
}

function persistToStorage(preference: StageOverlayPreferences) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STRUDEL_KEY, preference.strudelLab ? '1' : '0');
    storage.setItem(DEBUG_HUD_KEY, preference.debugHud ? '1' : '0');
  } catch {
    // Best-effort persistence; a blocked storage cannot hold the UI hostage.
  }
}

export function getStageOverlayPreference(): StageOverlayPreferences {
  if (!activePreference) {
    activePreference = readFromStorage();
  }
  return activePreference;
}

export function setStageOverlayPreference(
  update: Partial<StageOverlayPreferences>,
) {
  const current = getStageOverlayPreference();
  const next = {
    ...current,
    ...update,
    strudelLab: update.strudelLab ?? current.strudelLab,
    debugHud: update.debugHud ?? current.debugHud,
  };
  activePreference = next;
  persistToStorage(next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function subscribeToStageOverlayPreference(
  subscriber: StageOverlaySubscriber,
) {
  subscribers.add(subscriber);
  if (activePreference) {
    subscriber(activePreference);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetStageOverlayPreferenceState() {
  activePreference = null;
  subscribers.clear();
}
