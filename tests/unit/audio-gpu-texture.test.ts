import { describe, expect, it } from 'bun:test';
import {
  createAudioTextureBuffer,
  SharedAudioGpuTextureManager,
} from '../../src/js/core/audio-gpu-texture.ts';

describe('Shared Audio GPU Texture Packing', () => {
  it('creates 512x2 RGBA texture buffer from frequency and waveform arrays', () => {
    const freq = new Uint8Array(256);
    freq.fill(200);
    const wave = new Uint8Array(256);
    wave.fill(160);

    const buffer = createAudioTextureBuffer(freq, wave, 512);

    expect(buffer.width).toBe(512);
    expect(buffer.height).toBe(2);
    expect(buffer.data.length).toBe(512 * 2 * 4);

    // Row 0 (Frequency) R channel should contain 200
    expect(buffer.data[0]).toBe(200);
    expect(buffer.data[3]).toBe(255); // Alpha = 255

    // Row 1 (Waveform) R channel should contain 160
    const row1Offset = 512 * 4;
    expect(buffer.data[row1Offset]).toBe(160);
    expect(buffer.data[row1Offset + 1]).toBe(Math.abs(160 - 128) * 2); // Magnitude
    expect(buffer.data[row1Offset + 3]).toBe(255);
  });

  it('reuses one Three.js texture and backing allocation across updates', () => {
    const manager = new SharedAudioGpuTextureManager(4);
    expect(manager.getTexture()).toBeNull();

    manager.update(
      new Uint8Array([10, 20, 30, 40]),
      new Uint8Array([128, 140, 116, 128]),
    );
    const texture = manager.getTexture();
    expect(texture).not.toBeNull();
    if (!texture) {
      throw new Error('Expected a shared audio texture.');
    }
    const data = texture.image.data as Uint8Array;
    const version = texture.version;
    expect(
      Array.from(data.slice(0, 16).filter((_, index) => index % 4 === 0)),
    ).toEqual([10, 20, 30, 40]);

    manager.update(
      new Uint8Array([50, 60, 70, 80]),
      new Uint8Array([128, 128, 128, 128]),
    );

    expect(manager.getTexture()).toBe(texture);
    expect(texture.image.data).toBe(data);
    expect(texture.version).toBeGreaterThan(version);
    expect(data[0]).toBe(50);
    expect(data[12]).toBe(80);
  });

  it('does not expose an uninitialized texture when audio samples are absent', () => {
    const manager = new SharedAudioGpuTextureManager(4);
    manager.update(new Uint8Array(), undefined);
    expect(manager.getTexture()).toBeNull();
  });
});
