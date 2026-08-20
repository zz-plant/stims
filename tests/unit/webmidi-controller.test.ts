import { describe, expect, it } from 'bun:test';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  VIRTUAL_GAMEPAD_DEVICE_ID,
  WebMidiControllerService,
} from '../../src/js/core/services/webmidi-controller.ts';

const MIDI_STORAGE_KEY = 'stims:midi-state:v1';

describe('WebMIDI Hardware Controller Service', () => {
  it('ignores malformed persisted device records and bindings', () => {
    localStorage.setItem(
      MIDI_STORAGE_KEY,
      JSON.stringify({
        broken: null,
        valid: {
          enabled: true,
          bindings: {
            1: { target: 'zoom', min: 0, max: 2 },
            200: { target: 'bad-cc', min: 0, max: 1 },
            2: { target: 42, min: 0, max: 1 },
          },
        },
      }),
    );

    const service = new WebMidiControllerService();
    expect(service.getBindings('broken')).toEqual({});
    expect(service.getBindings('valid')).toEqual({
      1: { target: 'zoom', min: 0, max: 2 },
    });
    localStorage.removeItem(MIDI_STORAGE_KEY);
  });
  it('correctly reports support status when WebMIDI API is absent or present', () => {
    const service = new WebMidiControllerService();
    expect(service.isSupported()).toBe(false);
  });

  it('always includes the virtual devices, enabled by default', () => {
    const service = new WebMidiControllerService();
    const devices = service.getDevices();
    // Claude and the gamepad are both modeled as virtual MIDI devices so they
    // reuse the same binding, learn, and enable machinery as real hardware.
    expect(devices).toEqual([
      {
        id: VIRTUAL_CLAUDE_DEVICE_ID,
        name: 'Claude (MCP)',
        manufacturer: 'Anthropic',
        kind: 'virtual',
        state: 'connected',
        enabled: true,
      },
      {
        id: VIRTUAL_GAMEPAD_DEVICE_ID,
        name: 'Gamepad',
        manufacturer: 'Browser',
        kind: 'virtual',
        state: 'connected',
        enabled: true,
      },
    ]);
  });

  it('allows binding custom CC numbers to register targets, scoped per device', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 16, 'warp', 0, 5);
    service.bindCc('device-b', 16, 'zoom', 0, 2);

    expect(service.getBindings('device-a')[16]).toEqual({
      target: 'warp',
      min: 0,
      max: 5,
    });
    expect(service.getBindings('device-b')[16]).toEqual({
      target: 'zoom',
      min: 0,
      max: 2,
    });
  });

  it('removes a binding with unbindCc', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 5, 'rot', -1, 1);
    expect(service.getBindings('device-a')[5]).toBeDefined();

    service.unbindCc('device-a', 5);
    expect(service.getBindings('device-a')[5]).toBeUndefined();
  });

  it('parses MIDI Control Change (CC) messages correctly', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 1, 'zoom', 0.8, 1.2);
    let received: {
      cc: number;
      target?: string;
      normalized?: number;
      deviceId: string;
    } | null = null;

    service.onControlChange((cc, _raw, target, normalized, deviceId) => {
      received = { cc, target, normalized, deviceId };
    });

    const result = service.handleMidiMessage(
      'device-a',
      new Uint8Array([0xb0, 0x01, 0x7f]),
    );
    expect(result).not.toBeNull();
    expect(result?.cc).toBe(1);
    expect(result?.target).toBe('zoom');
    expect(result?.normalized).toBeCloseTo(1.2, 2);

    expect(received).not.toBeNull();
    expect((received as unknown as { deviceId: string }).deviceId).toBe(
      'device-a',
    );
  });

  it('ignores non-CC messages and short payloads', () => {
    const service = new WebMidiControllerService();
    expect(
      service.handleMidiMessage('device-a', new Uint8Array([0x90, 0x40])),
    ).toBeNull();
    expect(
      service.handleMidiMessage('device-a', new Uint8Array([0x90, 0x40, 0x7f])),
    ).toBeNull();
  });

  it('learn mode binds the next incoming CC to the requested target, once', () => {
    const service = new WebMidiControllerService();
    expect(service.getLearnTarget()).toBeNull();

    service.beginLearn('q3');
    expect(service.getLearnTarget()).toBe('q3');

    service.handleMidiMessage('device-a', new Uint8Array([0xb0, 42, 100]));
    expect(service.getLearnTarget()).toBeNull();
    expect(service.getBindings('device-a')[42]?.target).toBe('q3');

    // A second CC after learn mode has cleared must not rebind.
    service.handleMidiMessage('device-a', new Uint8Array([0xb0, 43, 50]));
    expect(service.getBindings('device-a')[43]).toBeUndefined();
  });

  it('clears the learn target before notifying devicesChanged, not after', () => {
    // Regression: bindCc synchronously fires onDevicesChanged. A listener
    // that reads getLearnTarget() === null inside that callback (this is
    // how the editor's slider "listening" state and the Performance
    // hardware panel's "Mapped a knob" message both detect completion)
    // must see the already-cleared value, not the target that's about to
    // be cleared on the next line.
    const service = new WebMidiControllerService();
    service.beginLearn('rot');

    let observedDuringNotify: string | null = 'not called';
    service.onDevicesChanged(() => {
      observedDuringNotify = service.getLearnTarget();
    });

    service.handleMidiMessage('device-a', new Uint8Array([0xb0, 7, 90]));

    expect(observedDuringNotify).toBeNull();
  });

  it('cancelLearn aborts an in-progress learn without binding', () => {
    const service = new WebMidiControllerService();
    service.beginLearn('q1');
    service.cancelLearn();
    expect(service.getLearnTarget()).toBeNull();

    service.handleMidiMessage('device-a', new Uint8Array([0xb0, 9, 10]));
    expect(service.getBindings('device-a')[9]).toBeUndefined();
  });

  it('a disabled device stops resolving targets but keeps its bindings', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 1, 'zoom', 0.8, 1.2);
    service.setDeviceEnabled('device-a', false);

    const result = service.handleMidiMessage(
      'device-a',
      new Uint8Array([0xb0, 1, 127]),
    );
    expect(result?.target).toBeUndefined();
    expect(service.getBindings('device-a')[1]).toEqual({
      target: 'zoom',
      min: 0.8,
      max: 1.2,
    });
  });

  it('injectControlChange lets the virtual Claude device drive targets like hardware', () => {
    const service = new WebMidiControllerService();
    service.bindCc(VIRTUAL_CLAUDE_DEVICE_ID, 1, 'warp', 0, 2);

    const result = service.injectControlChange(VIRTUAL_CLAUDE_DEVICE_ID, 1, 64);
    expect(result.target).toBe('warp');
    expect(result.normalized).toBeCloseTo(1.0, 1);
  });

  it('injectTargetValue sets a named target directly, bypassing CC math', () => {
    const service = new WebMidiControllerService();
    const seen: Array<[string | undefined, number | undefined]> = [];
    service.onControlChange((_cc, _raw, target, normalized) => {
      seen.push([target, normalized]);
    });

    service.injectTargetValue(VIRTUAL_CLAUDE_DEVICE_ID, 'zoom', 1.4);
    expect(seen).toEqual([['zoom', 1.4]]);
  });

  it('getAllBindings reports every device that has bindings, keyed by id', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 1, 'zoom', 0.8, 1.2);
    service.bindCc(VIRTUAL_CLAUDE_DEVICE_ID, 2, 'warp', 0, 2);

    const all = service.getAllBindings();
    expect(all['device-a']?.[1]?.target).toBe('zoom');
    expect(all[VIRTUAL_CLAUDE_DEVICE_ID]?.[2]?.target).toBe('warp');
  });

  // ── Notes ───────────────────────────────────────────────────────
  it('parses note-on and note-off, treating velocity 0 as a release', () => {
    const service = new WebMidiControllerService();
    const events: Array<{ note: number; on: boolean }> = [];
    service.onNote((event) => events.push({ note: event.note, on: event.on }));

    service.handleMidiMessage('pad', new Uint8Array([0x90, 60, 100]));
    // The conventional note-off: note-on with zero velocity.
    service.handleMidiMessage('pad', new Uint8Array([0x90, 60, 0]));
    // The explicit note-off status.
    service.handleMidiMessage('pad', new Uint8Array([0x80, 62, 64]));

    expect(events).toEqual([
      { note: 60, on: true },
      { note: 60, on: false },
      { note: 62, on: false },
    ]);
  });

  it('a trigger binding yields a value on press only', () => {
    const service = new WebMidiControllerService();
    service.bindNote('pad', 36, 'next-preset', { mode: 'trigger' });
    const values: Array<number | undefined> = [];
    service.onNote((event) => values.push(event.value));

    service.injectNote('pad', 36, true, 127);
    service.injectNote('pad', 36, false, 0);
    expect(values).toEqual([1, undefined]);
  });

  it('a gate binding holds max while held and returns to min on release', () => {
    const service = new WebMidiControllerService();
    service.bindNote('pad', 40, 'warp', { mode: 'gate', min: 0, max: 2 });
    const values: Array<number | undefined> = [];
    service.onNote((event) => values.push(event.value));

    service.injectNote('pad', 40, true, 127);
    service.injectNote('pad', 40, false, 0);
    expect(values).toEqual([2, 0]);
  });

  it('a toggle binding latches across presses and ignores releases', () => {
    const service = new WebMidiControllerService();
    service.bindNote('pad', 41, 'invert', { mode: 'toggle', min: 0, max: 1 });
    const values: Array<number | undefined> = [];
    service.onNote((event) => values.push(event.value));

    service.injectNote('pad', 41, true, 127);
    service.injectNote('pad', 41, false, 0);
    service.injectNote('pad', 41, true, 127);
    expect(values).toEqual([1, undefined, 0]);
  });

  it('scales a velocity-sensitive binding by how hard the pad was hit', () => {
    const service = new WebMidiControllerService();
    service.bindNote('pad', 44, 'warp', {
      mode: 'gate',
      min: 0,
      max: 1,
      velocitySensitive: true,
    });
    const values: Array<number | undefined> = [];
    service.onNote((event) => values.push(event.value));

    service.injectNote('pad', 44, true, 64);
    expect(values[0]).toBeCloseTo(64 / 127, 6);
  });

  it('persists note bindings across a reload', () => {
    const first = new WebMidiControllerService();
    first.bindNote('pad', 36, 'next-preset', { mode: 'toggle', max: 3 });

    const second = new WebMidiControllerService();
    expect(second.getNoteBindings('pad')[36]).toEqual({
      target: 'next-preset',
      mode: 'toggle',
      min: 0,
      max: 3,
      velocitySensitive: false,
    });
  });

  // ── Clock ───────────────────────────────────────────────────────
  it('ignores single-byte real-time messages instead of dropping them as short', () => {
    const service = new WebMidiControllerService();
    // The old 3-byte length guard rejected every clock tick before parsing.
    expect(() =>
      service.handleMidiMessage('deck', new Uint8Array([0xf8])),
    ).not.toThrow();
    expect(service.getClockSnapshot().running).toBe(true);
  });

  it('derives tempo from clock ticks at 24 PPQN', () => {
    const service = new WebMidiControllerService();
    let now = 1000;
    const originalNow = performance.now;
    // 120bpm = 500ms per beat = 20.833ms per tick at 24 PPQN.
    const tickMs = 500 / 24;
    performance.now = () => now;
    try {
      service.handleMidiMessage('deck', new Uint8Array([0xfa]));
      for (let i = 0; i < 48; i += 1) {
        service.handleMidiMessage('deck', new Uint8Array([0xf8]));
        now += tickMs;
      }
    } finally {
      performance.now = originalNow;
    }

    const snapshot = service.getClockSnapshot();
    expect(snapshot.bpm).toBeCloseTo(120, 1);
    expect(snapshot.running).toBe(true);
    expect(snapshot.beat).toBe(2);
  });

  it('start resets the bar position and stop clears running', () => {
    const service = new WebMidiControllerService();
    for (let i = 0; i < 30; i += 1) {
      service.handleMidiMessage('deck', new Uint8Array([0xf8]));
    }
    expect(service.getClockSnapshot().beat).toBe(1);

    service.handleMidiMessage('deck', new Uint8Array([0xfa]));
    expect(service.getClockSnapshot().beat).toBe(0);
    expect(service.getClockSnapshot().barPosition).toBe(0);

    service.handleMidiMessage('deck', new Uint8Array([0xfc]));
    expect(service.getClockSnapshot().running).toBe(false);
  });

  it('reports bar position across four beats', () => {
    const service = new WebMidiControllerService();
    service.handleMidiMessage('deck', new Uint8Array([0xfa]));
    // Two full beats in: halfway through a 4/4 bar.
    for (let i = 0; i < 48; i += 1) {
      service.handleMidiMessage('deck', new Uint8Array([0xf8]));
    }
    expect(service.getClockSnapshot().barPosition).toBeCloseTo(0.5, 6);
  });

  // ── Output feedback ─────────────────────────────────────────────
  it('reports no output port for a device that has none, and sends nothing', () => {
    const service = new WebMidiControllerService();
    service.bindCc('device-a', 1, 'zoom', 0, 1);
    expect(service.hasOutput('device-a')).toBe(false);
    // Without a paired port this must be inert rather than throwing.
    expect(() => service.publishTargetValue('zoom', 0.5)).not.toThrow();
    expect(() => service.sendControlChange('device-a', 1, 64)).not.toThrow();
  });

  // ── Clock output ────────────────────────────────────────────────
  it('does not emit clock output before it is started', () => {
    const service = new WebMidiControllerService();
    expect(service.isClockOutputRunning()).toBe(false);
  });

  it('starting and stopping clock output is inert without an output port', () => {
    const service = new WebMidiControllerService();
    // No paired output exists in a bare service; this must be safe anyway.
    expect(() => service.startClockOutput(() => 120)).not.toThrow();
    expect(service.isClockOutputRunning()).toBe(true);
    expect(() => service.stopClockOutput()).not.toThrow();
    expect(service.isClockOutputRunning()).toBe(false);
  });

  it('stopping clock output twice is harmless', () => {
    const service = new WebMidiControllerService();
    service.startClockOutput(() => 128);
    service.stopClockOutput();
    expect(() => service.stopClockOutput()).not.toThrow();
    expect(service.isClockOutputRunning()).toBe(false);
  });

  it('a null tempo keeps clock output running without emitting a guessed rate', () => {
    const service = new WebMidiControllerService();
    // A confidence-gated beat clock reports null until it is sure; the output
    // must wait rather than lock followers onto an invented tempo.
    service.startClockOutput(() => null);
    expect(service.isClockOutputRunning()).toBe(true);
    service.stopClockOutput();
  });
});
