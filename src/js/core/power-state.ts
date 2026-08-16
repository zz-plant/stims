import {
  getPowerSaverMode,
  subscribeToPowerSaverMode,
} from './state/power-saver-store.ts';
import { getActiveQualityPreset } from './state/quality-preset-store.ts';

/**
 * Battery Status API surface. Not in lib.dom, and absent entirely in Safari and
 * Firefox, so every read has to tolerate `supported: false`.
 */
type BatteryManagerLike = EventTarget & {
  charging: boolean;
  level: number;
};

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};

export type BatterySnapshot = {
  /** False when the browser has no Battery Status API. */
  supported: boolean;
  /** `null` until the async probe resolves, and whenever unsupported. */
  charging: boolean | null;
  /** 0..1, `null` until the async probe resolves. */
  level: number | null;
};

/**
 * How much power the session is currently giving up frame rate for.
 *
 * `conserving` is the near-free tier: it only caps the *excess* above 60Hz, so
 * a 120Hz laptop stops doing double the GPU work for motion almost nobody can
 * see on an unplugged machine. `saving` is the visible tier — half rate — and
 * is reserved for a genuinely low battery or an explicit opt-in.
 */
export type PowerSavingLevel = 'off' | 'conserving' | 'saving';

/** Below this charge, `auto` escalates from `conserving` to `saving`. */
export const LOW_BATTERY_LEVEL = 0.35;

export const CONSERVING_FRAME_CAP_HZ = 60;
export const SAVING_FRAME_CAP_HZ = 30;

/**
 * The quality preset literally labelled "Battery saver". Choosing it by hand is
 * as explicit a request for the strong tier as toggling the setting is, and it
 * is the only tier that helps the fan noise its description promises to fix.
 */
const BATTERY_SAVER_QUALITY_PRESET_ID = 'performance';

const EMPTY_SNAPSHOT: BatterySnapshot = {
  supported: false,
  charging: null,
  level: null,
};

type BatterySubscriber = (snapshot: BatterySnapshot) => void;

const subscribers = new Set<BatterySubscriber>();
let snapshot: BatterySnapshot = EMPTY_SNAPSHOT;
let monitoringPromise: Promise<BatterySnapshot> | null = null;

function publish(next: BatterySnapshot) {
  snapshot = next;
  subscribers.forEach((subscriber) => subscriber(next));
}

/**
 * Reads `navigator.getBattery()` once and then tracks it live: a laptop being
 * unplugged mid-session is exactly the moment the frame cap should engage, and
 * a one-shot read would miss it.
 *
 * Safe to call repeatedly — only the first call probes. Never rejects; an
 * unsupported or blocked API resolves to the unsupported snapshot so callers
 * can await readiness without a try/catch.
 */
export function startBatteryMonitoring(): Promise<BatterySnapshot> {
  if (monitoringPromise) {
    return monitoringPromise;
  }

  const getBattery =
    typeof navigator !== 'undefined'
      ? (navigator as NavigatorWithBattery).getBattery
      : undefined;

  if (typeof getBattery !== 'function') {
    monitoringPromise = Promise.resolve(EMPTY_SNAPSHOT);
    return monitoringPromise;
  }

  monitoringPromise = getBattery
    .call(navigator)
    .then((battery) => {
      const sync = () => {
        publish({
          supported: true,
          charging: Boolean(battery.charging),
          level:
            typeof battery.level === 'number' && Number.isFinite(battery.level)
              ? battery.level
              : null,
        });
      };
      battery.addEventListener('chargingchange', sync);
      battery.addEventListener('levelchange', sync);
      sync();
      return snapshot;
    })
    .catch(() => {
      // Chrome rejects this in insecure contexts and some embedded webviews.
      publish(EMPTY_SNAPSHOT);
      return EMPTY_SNAPSHOT;
    });

  return monitoringPromise;
}

export function getBatterySnapshot(): BatterySnapshot {
  return snapshot;
}

export function subscribeToBatterySnapshot(subscriber: BatterySubscriber) {
  subscribers.add(subscriber);
  subscriber(snapshot);
  return () => {
    subscribers.delete(subscriber);
  };
}

/**
 * Resolves once the battery probe has settled, or after `timeoutMs`, whichever
 * comes first. Renderer setup uses this: adapter selection is a one-shot,
 * session-long decision, so it is worth waiting a few milliseconds to make it
 * on real data — but never worth stalling first paint if the API hangs.
 */
export function whenBatteryStateSettled(
  timeoutMs = 120,
): Promise<BatterySnapshot> {
  const probe = startBatteryMonitoring();
  // Resolve immediately when the Battery API is absent (Safari, Firefox,
  // insecure contexts, embedded webviews) — the common case. Only race the
  // timeout when the API is actually present and might resolve with useful data.
  if (snapshot.supported || typeof window === 'undefined') {
    return probe;
  }
  const getBattery =
    typeof navigator !== 'undefined'
      ? (navigator as NavigatorWithBattery).getBattery
      : undefined;
  if (typeof getBattery !== 'function') {
    return probe;
  }
  return Promise.race([
    probe,
    new Promise<BatterySnapshot>((resolve) => {
      window.setTimeout(() => resolve(snapshot), timeoutMs);
    }),
  ]);
}

function isBatterySaverQualityPreset(): boolean {
  try {
    return getActiveQualityPreset().id === BATTERY_SAVER_QUALITY_PRESET_ID;
  } catch {
    return false;
  }
}

export function getPowerSavingLevel(): PowerSavingLevel {
  const mode = getPowerSaverMode();
  if (mode === 'off') {
    return 'off';
  }
  if (mode === 'on') {
    return 'saving';
  }

  if (isBatterySaverQualityPreset()) {
    return 'saving';
  }

  // `charging === null` means the probe has not resolved or the browser has no
  // battery API. Neither is evidence of running on battery, so auto stays off:
  // silently halving the frame rate of a plugged-in desktop would be worse than
  // missing the optimization on Safari.
  if (snapshot.charging !== false) {
    return 'off';
  }

  return snapshot.level !== null && snapshot.level <= LOW_BATTERY_LEVEL
    ? 'saving'
    : 'conserving';
}

function isAgentModeDocument(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement?.dataset.agentMode === 'true'
  );
}

/**
 * Frame ceiling in Hz, or `null` to present at display cadence.
 *
 * Agent mode is never capped: headless capture, the preset labs, and browser
 * QA all measure per-frame behaviour, and a gate that silently drops half the
 * frames would corrupt every reactivity number they produce.
 */
export function getPowerSavingFrameCapHz(): number | null {
  if (isAgentModeDocument()) {
    return null;
  }
  switch (getPowerSavingLevel()) {
    case 'saving':
      return SAVING_FRAME_CAP_HZ;
    case 'conserving':
      return CONSERVING_FRAME_CAP_HZ;
    default:
      return null;
  }
}

/**
 * GPU to ask for at adapter/context creation.
 *
 * Only the `saving` tier drops to `low-power`. On a dual-GPU laptop this is the
 * single largest lever available — keeping the discrete GPU asleep is worth
 * tens of watts, far more than any resolution or frame-rate change — but it is
 * also a session-long, one-way decision that visibly softens the render, so it
 * stays tied to an explicit opt-in or a genuinely low battery.
 */
export function resolveGpuPowerPreference(): 'high-performance' | 'low-power' {
  return getPowerSavingLevel() === 'saving' ? 'low-power' : 'high-performance';
}

export function subscribeToPowerSavingLevel(
  subscriber: (level: PowerSavingLevel) => void,
) {
  let last = getPowerSavingLevel();
  subscriber(last);
  const notify = () => {
    const next = getPowerSavingLevel();
    if (next !== last) {
      last = next;
      subscriber(next);
    }
  };
  const unsubscribeBattery = subscribeToBatterySnapshot(notify);
  const unsubscribeMode = subscribeToPowerSaverMode(notify);
  return () => {
    unsubscribeBattery();
    unsubscribeMode();
  };
}

export function resetPowerStateForTests() {
  snapshot = EMPTY_SNAPSHOT;
  monitoringPromise = null;
  subscribers.clear();
}
