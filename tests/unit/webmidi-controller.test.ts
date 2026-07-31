import { describe, expect, it } from 'bun:test';
import { WebMidiControllerService } from '../../src/js/core/services/webmidi-controller.ts';

describe('WebMIDI Hardware Controller Service', () => {
  it('correctly reports support status when WebMIDI API is absent or present', () => {
    const service = new WebMidiControllerService();
    expect(service.isSupported()).toBe(false);
  });

  it('allows binding custom CC numbers to register targets', () => {
    const service = new WebMidiControllerService();
    service.bindCc(16, 'warp', 0, 5);

    const bindings = service.getBindings();
    expect(bindings[16]).toEqual({ target: 'warp', min: 0, max: 5 });
  });

  it('parses MIDI Control Change (CC) messages correctly', () => {
    const service = new WebMidiControllerService();
    let receivedCc: number | null = null;
    let receivedTarget: string | undefined;
    let receivedNormalized: number | undefined;

    service.onControlChange((cc, _raw, target, normalized) => {
      receivedCc = cc;
      receivedTarget = target;
      receivedNormalized = normalized;
    });

    // MIDI CC 1 (zoom) with max value 127
    const result = service.handleMidiMessage(
      new Uint8Array([0xb0, 0x01, 0x7f]),
    );
    expect(result).not.toBeNull();
    expect(result?.cc).toBe(1);
    expect(result?.target).toBe('zoom');
    expect(result?.normalized).toBeCloseTo(1.2, 2);

    expect(receivedCc as unknown as number).toBe(1);
    expect(receivedTarget).toBe('zoom');
    expect(receivedNormalized as unknown as number).toBeCloseTo(1.2, 2);
  });
});
