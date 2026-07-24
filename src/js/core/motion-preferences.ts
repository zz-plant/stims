export type MotionPreference = {
  enabled: boolean;
};

type MotionPreferenceSubscriber = (preference: MotionPreference) => void;

type MotionPreferenceInput = Partial<MotionPreference>;

const MOTION_PREFERENCE_KEY = 'stims:motion-enabled';

const subscribers = new Set<MotionPreferenceSubscriber>();
let activePreference: MotionPreference | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

function readFromStorage(): MotionPreference {
  const storage = getStorage();
  const raw = storage?.getItem(MOTION_PREFERENCE_KEY);
  if (raw === null) {
    return { enabled: true };
  }
  return { enabled: raw !== 'false' };
}

function persistToStorage(preference: MotionPreference) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(MOTION_PREFERENCE_KEY, preference.enabled ? 'true' : 'false');
}

export function getActiveMotionPreference() {
  if (!activePreference) {
    activePreference = readFromStorage();
  }
  return activePreference;
}

export function setMotionPreference(update: MotionPreferenceInput) {
  const current = getActiveMotionPreference();
  const next = {
    ...current,
    ...update,
    enabled:
      typeof update.enabled === 'boolean' ? update.enabled : current.enabled,
  };
  activePreference = next;
  persistToStorage(next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function subscribeToMotionPreference(
  subscriber: MotionPreferenceSubscriber,
) {
  subscribers.add(subscriber);
  if (activePreference) {
    subscriber(activePreference);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetMotionPreferenceState() {
  activePreference = null;
  subscribers.clear();
}
