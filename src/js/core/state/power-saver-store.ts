import { getPowerSaverOverride } from '../url-params.ts';
import { getBrowserStorage } from './browser-storage.ts';

/**
 * How hard the session trades frame rate and GPU selection for power draw.
 *
 * `auto` is the default and is deliberately inert until the Battery Status API
 * reports the device is actually discharging — a plugged-in desktop is never
 * throttled, so the setting costs nothing to leave on. `on`/`off` are explicit
 * user choices and always win, including on browsers with no battery API
 * (Safari, Firefox), which is the only way to get power saving there.
 */
export type PowerSaverMode = 'auto' | 'on' | 'off';

export const POWER_SAVER_STORAGE_KEY = 'stims:power-saver';
export const DEFAULT_POWER_SAVER_MODE: PowerSaverMode = 'auto';

type PowerSaverSubscriber = (mode: PowerSaverMode) => void;

const subscribers = new Set<PowerSaverSubscriber>();
let activeMode: PowerSaverMode | null = null;

/**
 * Accepts the boolean spellings as well as the three mode names so
 * `?powerSaver=1` does the obvious thing in a QA link.
 */
export function parsePowerSaverMode(value: unknown): PowerSaverMode | null {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'auto' || normalized === 'on' || normalized === 'off') {
    return normalized;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return 'on';
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return 'off';
  }
  return null;
}

function readUrlOverride(): PowerSaverMode | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return parsePowerSaverMode(getPowerSaverOverride());
  } catch {
    return null;
  }
}

function readMode(): PowerSaverMode {
  const override = readUrlOverride();
  if (override) {
    return override;
  }
  const stored = getBrowserStorage()?.getItem(POWER_SAVER_STORAGE_KEY) ?? null;
  return parsePowerSaverMode(stored) ?? DEFAULT_POWER_SAVER_MODE;
}

export function getPowerSaverMode(): PowerSaverMode {
  if (!activeMode) {
    activeMode = readMode();
  }
  return activeMode;
}

export function setPowerSaverMode(mode: PowerSaverMode): PowerSaverMode {
  const next = parsePowerSaverMode(mode) ?? DEFAULT_POWER_SAVER_MODE;
  activeMode = next;
  getBrowserStorage()?.setItem(POWER_SAVER_STORAGE_KEY, next);
  subscribers.forEach((subscriber) => subscriber(next));
  return next;
}

export function subscribeToPowerSaverMode(subscriber: PowerSaverSubscriber) {
  subscribers.add(subscriber);
  if (activeMode) {
    subscriber(activeMode);
  }
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetPowerSaverStore() {
  activeMode = null;
  subscribers.clear();
}
