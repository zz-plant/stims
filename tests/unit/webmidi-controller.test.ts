import { describe, expect, it } from 'bun:test';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  WebMidiControllerService,
} from '../../src/js/core/services/webmidi-controller.ts';

describe('WebMIDI Hardware Controller Service', () => {
  it('correctly reports support status when WebMIDI API is absent or present', () => {
    const service = new WebMidiControllerService();
    expect(service.isSupported()).toBe(false);
  });

  it('always includes the virtual Claude (MCP) device, enabled by default', () => {
    const service = new WebMidiControllerService();
    const devices = service.getDevices();
    expect(devices).toEqual([
      {
        id: VIRTUAL_CLAUDE_DEVICE_ID,
        name: 'Claude (MCP)',
        manufacturer: 'Anthropic',
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
});
