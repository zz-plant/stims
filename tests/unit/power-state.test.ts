import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getBatterySnapshot,
  getPowerSavingFrameCapHz,
  getPowerSavingLevel,
  LOW_BATTERY_LEVEL,
  resetPowerStateForTests,
  resolveGpuPowerPreference,
  startBatteryMonitoring,
  subscribeToPowerSavingLevel,
} from '../../src/js/core/power-state.ts';
import {
  parsePowerSaverMode,
  resetPowerSaverStore,
  setPowerSaverMode,
} from '../../src/js/core/state/power-saver-store.ts';
import {
  resetQualityPresetState,
  setQualityPresetById,
} from '../../src/js/core/state/quality-preset-store.ts';

/**
 * Hand-rolled rather than a real EventTarget: this suite runs in an environment
 * where the global `Event` and `EventTarget` come from different realms, so
 * `dispatchEvent(new Event(...))` throws on argument type. Only
 * addEventListener is exercised by the module under test anyway.
 */
function installFakeBattery(charging: boolean, level: number) {
  const listeners: (() => void)[] = [];
  const target = {
    charging,
    level,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener);
    },
    removeEventListener: () => {},
  };
  (
    globalThis.navigator as Navigator & { getBattery?: () => Promise<unknown> }
  ).getBattery = () => Promise.resolve(target);
  return {
    update(next: { charging?: boolean; level?: number }) {
      if (next.charging !== undefined) target.charging = next.charging;
      if (next.level !== undefined) target.level = next.level;
      listeners.forEach((listener) => listener());
    },
  };
}

function removeBatteryApi() {
  delete (globalThis.navigator as Navigator & { getBattery?: unknown })
    .getBattery;
}

beforeEach(() => {
  resetPowerStateForTests();
  resetPowerSaverStore();
  resetQualityPresetState();
  globalThis.localStorage?.clear();
  document.documentElement.dataset.agentMode = 'false';
});

afterEach(() => {
  removeBatteryApi();
  resetPowerStateForTests();
  resetPowerSaverStore();
  resetQualityPresetState();
  globalThis.localStorage?.clear();
  delete document.documentElement.dataset.agentMode;
});

describe('parsePowerSaverMode', () => {
  test('accepts the mode names and the boolean spellings', () => {
    expect(parsePowerSaverMode('auto')).toBe('auto');
    expect(parsePowerSaverMode(' ON ')).toBe('on');
    expect(parsePowerSaverMode('Off')).toBe('off');
    expect(parsePowerSaverMode('1')).toBe('on');
    expect(parsePowerSaverMode('false')).toBe('off');
  });

  test('rejects anything else rather than guessing', () => {
    expect(parsePowerSaverMode('maybe')).toBeNull();
    expect(parsePowerSaverMode('')).toBeNull();
    expect(parsePowerSaverMode(undefined)).toBeNull();
    expect(parsePowerSaverMode(3)).toBeNull();
  });
});

describe('startBatteryMonitoring', () => {
  test('reports unsupported without a battery API and never rejects', async () => {
    removeBatteryApi();
    const snapshot = await startBatteryMonitoring();
    expect(snapshot.supported).toBe(false);
    expect(snapshot.charging).toBeNull();
    expect(snapshot.level).toBeNull();
  });

  test('tracks charge state changes after the initial probe', async () => {
    const fake = installFakeBattery(true, 0.9);
    await startBatteryMonitoring();
    expect(getBatterySnapshot()).toEqual({
      supported: true,
      charging: true,
      level: 0.9,
    });

    fake.update({ charging: false, level: 0.8 });
    expect(getBatterySnapshot()).toEqual({
      supported: true,
      charging: false,
      level: 0.8,
    });
  });

  test('survives a rejected probe', async () => {
    (
      globalThis.navigator as Navigator & { getBattery?: () => Promise<never> }
    ).getBattery = () => Promise.reject(new Error('blocked'));
    const snapshot = await startBatteryMonitoring();
    expect(snapshot.supported).toBe(false);
  });
});

describe('getPowerSavingLevel', () => {
  test('stays off while charging', async () => {
    installFakeBattery(true, 0.15);
    await startBatteryMonitoring();
    expect(getPowerSavingLevel()).toBe('off');
    expect(getPowerSavingFrameCapHz()).toBeNull();
  });

  test('stays off when the browser has no battery API', async () => {
    // Safari and Firefox: an unknown power source must never be treated as
    // "on battery", or every desktop session there would silently run at 60Hz.
    removeBatteryApi();
    await startBatteryMonitoring();
    expect(getPowerSavingLevel()).toBe('off');
  });

  test('conserves on a healthy battery and saves on a low one', async () => {
    const fake = installFakeBattery(false, LOW_BATTERY_LEVEL + 0.1);
    await startBatteryMonitoring();
    expect(getPowerSavingLevel()).toBe('conserving');
    expect(getPowerSavingFrameCapHz()).toBe(60);

    fake.update({ level: LOW_BATTERY_LEVEL });
    expect(getPowerSavingLevel()).toBe('saving');
    expect(getPowerSavingFrameCapHz()).toBe(30);
  });

  test('the explicit modes override the battery reading in both directions', async () => {
    installFakeBattery(true, 1);
    await startBatteryMonitoring();

    setPowerSaverMode('on');
    expect(getPowerSavingLevel()).toBe('saving');

    setPowerSaverMode('off');
    expect(getPowerSavingLevel()).toBe('off');
  });

  test('off wins even on a nearly flat battery', async () => {
    installFakeBattery(false, 0.05);
    await startBatteryMonitoring();
    setPowerSaverMode('off');
    expect(getPowerSavingLevel()).toBe('off');
    expect(getPowerSavingFrameCapHz()).toBeNull();
  });

  test('the Battery saver quality preset implies the strong tier', async () => {
    installFakeBattery(true, 1);
    await startBatteryMonitoring();
    setQualityPresetById('performance');
    expect(getPowerSavingLevel()).toBe('saving');

    setQualityPresetById('balanced');
    expect(getPowerSavingLevel()).toBe('off');
  });
});

describe('getPowerSavingFrameCapHz', () => {
  test('never caps agent mode, whatever the power state', async () => {
    installFakeBattery(false, 0.05);
    await startBatteryMonitoring();
    setPowerSaverMode('on');
    document.documentElement.dataset.agentMode = 'true';
    // The labs and headless capture measure per-frame behaviour; a silent
    // half-rate gate would corrupt every number they produce.
    expect(getPowerSavingLevel()).toBe('saving');
    expect(getPowerSavingFrameCapHz()).toBeNull();
  });
});

describe('resolveGpuPowerPreference', () => {
  test('only the saving tier gives up the high-performance GPU', async () => {
    const fake = installFakeBattery(false, 0.9);
    await startBatteryMonitoring();
    expect(resolveGpuPowerPreference()).toBe('high-performance');

    fake.update({ level: 0.1 });
    expect(resolveGpuPowerPreference()).toBe('low-power');
  });
});

describe('subscribeToPowerSavingLevel', () => {
  test('emits the current level and then only on real transitions', async () => {
    const fake = installFakeBattery(false, 0.9);
    await startBatteryMonitoring();

    const seen: string[] = [];
    const unsubscribe = subscribeToPowerSavingLevel((level) => {
      seen.push(level);
    });

    fake.update({ level: 0.8 });
    fake.update({ level: 0.1 });
    setPowerSaverMode('off');
    unsubscribe();
    fake.update({ level: 0.05 });

    expect(seen).toEqual(['conserving', 'saving', 'off']);
  });
});
