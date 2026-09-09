/**
 * Covers the two hardware features that shipped inert: a gamepad whose axes
 * bound to nothing, and four factory MIDI profiles no module imported.
 */
import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_GAMEPAD_CC_BINDINGS,
  DEFAULT_MIDI_CC_BINDINGS,
  type MidiBindingMap,
  type MidiDeviceInfo,
  VIRTUAL_GAMEPAD_DEVICE_ID,
  WebMidiControllerService,
} from '../../src/js/core/services/webmidi-controller.ts';
import { matchMidiProfile } from '../../src/js/frontend/midi-controller-presets.ts';
import {
  GAMEPAD_CONNECTED_MESSAGE,
  type PerformanceHardwareMidi,
  watchPerformanceHardware,
} from '../../src/js/frontend/performance-hardware-connect.ts';

const MIDI_STORAGE_KEY = 'stims:midi-state:v1';

function hardwareDevice(
  overrides: Partial<MidiDeviceInfo> = {},
): MidiDeviceInfo {
  return {
    id: 'device-1',
    name: 'nanoKONTROL2 SLIDER/KNOB',
    manufacturer: 'KORG INC.',
    kind: 'hardware',
    state: 'connected',
    enabled: true,
    ...overrides,
  };
}

/** Records what was applied without touching storage or the real service. */
function stubMidi(
  devices: MidiDeviceInfo[],
  bindings: Record<string, MidiBindingMap> = {},
) {
  const applied: Array<{ deviceId: string; bindings: MidiBindingMap }> = [];
  let listener: ((next: MidiDeviceInfo[]) => void) | null = null;
  const midi: PerformanceHardwareMidi = {
    onDevicesChanged: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    getDevices: () => devices,
    getBindings: (deviceId) => bindings[deviceId] ?? {},
    applyDeviceProfile: (deviceId, ccBindings) => {
      applied.push({ deviceId, bindings: ccBindings });
    },
  };
  return { midi, applied, emit: (next: MidiDeviceInfo[]) => listener?.(next) };
}

describe('matchMidiProfile', () => {
  it('matches the strings drivers actually report, not the marketing name', () => {
    // Every one of these is the real name/manufacturer pair the device
    // announces — the reason a naive equality check found nothing.
    expect(matchMidiProfile('nanoKONTROL2 SLIDER/KNOB', 'KORG INC.')?.id).toBe(
      'korg-nanokontrol2',
    );
    expect(
      matchMidiProfile('Launch Control XL', 'Focusrite A.E. Ltd')?.id,
    ).toBe('novation-launch-control-xl');
    expect(matchMidiProfile('Minilab3 MIDI', 'Arturia')?.id).toBe(
      'arturia-minilab-3',
    );
  });

  it('returns null for an unknown controller rather than guessing', () => {
    // generic-dj-mixer describes a CC layout, not a device: returning it here
    // would overwrite the service's own defaults on every no-name controller.
    expect(matchMidiProfile('Some USB MIDI Device', 'Acme')).toBeNull();
    expect(matchMidiProfile(undefined)).toBeNull();
  });
});

describe('watchPerformanceHardware', () => {
  it('applies the factory profile to a controller nobody has remapped', () => {
    const device = hardwareDevice();
    const { midi, applied } = stubMidi([device], {
      [device.id]: { ...DEFAULT_MIDI_CC_BINDINGS },
    });
    const messages: string[] = [];

    const stop = watchPerformanceHardware({
      midi,
      announce: (message) => messages.push(message),
      target: null,
    });

    expect(applied).toHaveLength(1);
    expect(applied[0].deviceId).toBe(device.id);
    expect(applied[0].bindings[16].target).toBe('zoom');
    expect(messages[0]).toContain('Korg nanoKONTROL2 connected');
    stop();
  });

  it('leaves a controller the performer has already mapped alone', () => {
    const device = hardwareDevice();
    const { midi, applied } = stubMidi([device], {
      [device.id]: { 1: { target: 'wave_a', min: 0, max: 1 } },
    });
    const messages: string[] = [];

    const stop = watchPerformanceHardware({
      midi,
      announce: (message) => messages.push(message),
      target: null,
    });

    expect(applied).toHaveLength(0);
    // Still announced — the point is to say the device is live — but with the
    // generic summary, because their own mapping is what is running.
    expect(messages[0]).toContain('CC 1-4 and 7-10');
    stop();
  });

  it('announces a device once, not on every binding change', () => {
    const device = hardwareDevice({
      name: 'Generic Controller',
      manufacturer: '',
    });
    const { midi, emit } = stubMidi([device], { [device.id]: {} });
    const messages: string[] = [];

    const stop = watchPerformanceHardware({
      midi,
      announce: (message) => messages.push(message),
      target: null,
    });
    // onDevicesChanged doubles as the service's general "MIDI state changed"
    // signal, so it fires again on every learned binding and enable toggle.
    emit([device]);
    emit([device]);

    expect(messages).toHaveLength(1);
    stop();
  });

  it('ignores virtual devices and disconnected hardware', () => {
    const { midi } = stubMidi([
      hardwareDevice({ id: 'virtual:claude', kind: 'virtual' }),
      hardwareDevice({ id: 'gone', state: 'disconnected' }),
    ]);
    const messages: string[] = [];

    const stop = watchPerformanceHardware({
      midi,
      announce: (message) => messages.push(message),
      target: null,
    });

    expect(messages).toHaveLength(0);
    stop();
  });

  it('announces a gamepad once and stops listening on teardown', () => {
    const { midi } = stubMidi([]);
    const messages: string[] = [];
    const handlers = new Map<string, EventListenerOrEventListenerObject>();
    const target = {
      addEventListener: (
        type: string,
        handler: EventListenerOrEventListenerObject,
      ) => {
        handlers.set(type, handler);
      },
      removeEventListener: (type: string) => {
        handlers.delete(type);
      },
    } as unknown as Window;

    const stop = watchPerformanceHardware({
      midi,
      announce: (message) => messages.push(message),
      target,
    });

    const fire = () =>
      (handlers.get('gamepadconnected') as EventListener | undefined)?.(
        new Event('gamepadconnected'),
      );
    fire();
    fire();

    expect(messages).toEqual([GAMEPAD_CONNECTED_MESSAGE]);
    stop();
    expect(handlers.has('gamepadconnected')).toBe(false);
  });
});

describe('gamepad default bindings', () => {
  it('claims nothing until a pad is actually attached', () => {
    localStorage.removeItem(MIDI_STORAGE_KEY);
    const service = new WebMidiControllerService();
    // `virtual:gamepad` is a device on every machine, so binding it eagerly
    // made getEnabledTargets() report zoom/rot/dx/dy as hardware-driven in
    // every session — the editor's value chips and the parameter HUD would
    // name a controller nobody owns.
    expect(service.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});
    expect(service.getEnabledTargets().has('zoom')).toBe(false);
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('binds the pad the first time one is seen, so it works unmapped', () => {
    localStorage.removeItem(MIDI_STORAGE_KEY);
    const service = new WebMidiControllerService();
    service.ensureGamepadDefaults();

    // The regression this guards: virtual:gamepad was created lazily by the
    // first injected CC with an empty map, so every axis resolved to no
    // target and a plugged-in pad moved nothing.
    expect(service.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual(
      DEFAULT_GAMEPAD_CC_BINDINGS,
    );
    expect(
      service.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, 3, 127).target,
    ).toBe('zoom');
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('refills an empty map persisted by the build that had the bug', () => {
    localStorage.setItem(
      MIDI_STORAGE_KEY,
      JSON.stringify({
        [VIRTUAL_GAMEPAD_DEVICE_ID]: {
          enabled: true,
          bindings: {},
          noteBindings: {},
        },
      }),
    );
    const service = new WebMidiControllerService();
    service.ensureGamepadDefaults();
    expect(service.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual(
      DEFAULT_GAMEPAD_CC_BINDINGS,
    );
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('tells the bindings table about the mapping it just installed', () => {
    localStorage.removeItem(MIDI_STORAGE_KEY);
    const service = new WebMidiControllerService();
    let notifications = 0;
    service.onDevicesChanged(() => {
      notifications += 1;
    });

    service.ensureGamepadDefaults();
    // Without this the Settings row read "No mappings yet" beside a pad that
    // was already driving the preset: ensureDeviceRecord creates the record
    // with the defaults, so an after-the-fact "is it empty" check returns
    // early and never fires the change event the table listens on.
    expect(notifications).toBe(1);

    // Idempotent: a second pad appearing must not re-notify or re-persist.
    service.ensureGamepadDefaults();
    expect(notifications).toBe(1);
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('never overwrites a mapping the performer learned themselves', () => {
    localStorage.setItem(
      MIDI_STORAGE_KEY,
      JSON.stringify({
        [VIRTUAL_GAMEPAD_DEVICE_ID]: {
          enabled: true,
          bindings: { 0: { target: 'wave_a', min: 0, max: 1 } },
          noteBindings: {},
        },
      }),
    );
    const service = new WebMidiControllerService();
    service.ensureGamepadDefaults();
    expect(service.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({
      0: { target: 'wave_a', min: 0, max: 1 },
    });
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('leaves a map the performer emptied on purpose empty after a reload', () => {
    localStorage.removeItem(MIDI_STORAGE_KEY);
    const seeding = new WebMidiControllerService();
    seeding.ensureGamepadDefaults();
    for (const cc of Object.keys(DEFAULT_GAMEPAD_CC_BINDINGS)) {
      seeding.unbindCc(VIRTUAL_GAMEPAD_DEVICE_ID, Number(cc));
    }
    expect(seeding.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});

    // Removing all six mappings with the per-binding remove controls leaves
    // the same empty map the old bug left behind. Reading emptiness as the
    // repair signal put every default back here and silently undid the
    // choice; the persisted marker is what separates the two.
    const reloaded = new WebMidiControllerService();
    reloaded.ensureGamepadDefaults();

    expect(reloaded.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('marks a record an older build seeded, so it is repaired at most once', () => {
    // Written by a build that had no marker: the mapping is the factory one,
    // so it was seeded, and clearing it later must stick.
    localStorage.setItem(
      MIDI_STORAGE_KEY,
      JSON.stringify({
        [VIRTUAL_GAMEPAD_DEVICE_ID]: {
          enabled: true,
          bindings: { ...DEFAULT_GAMEPAD_CC_BINDINGS },
          noteBindings: {},
        },
      }),
    );
    const migrating = new WebMidiControllerService();
    migrating.ensureGamepadDefaults();
    for (const cc of Object.keys(DEFAULT_GAMEPAD_CC_BINDINGS)) {
      migrating.unbindCc(VIRTUAL_GAMEPAD_DEVICE_ID, Number(cc));
    }

    const reloaded = new WebMidiControllerService();
    reloaded.ensureGamepadDefaults();

    expect(reloaded.getBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });

  it('every stick axis rests on its parameter neutral', () => {
    // A pad sitting untouched must not bend the visuals: sticks self-centre
    // to CC 64ish and triggers rest at 0.
    localStorage.removeItem(MIDI_STORAGE_KEY);
    const service = new WebMidiControllerService();
    service.ensureGamepadDefaults();

    expect(
      service.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, 0, 64).normalized,
    ).toBeCloseTo(0, 3);
    expect(
      service.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, 3, 64).normalized,
    ).toBeCloseTo(1, 2);
    expect(
      service.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, 4, 0).normalized,
    ).toBe(0);
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });
});
