import { describe, expect, it } from 'bun:test';
import {
  createAudioTextureBuffer,
  SharedAudioGpuTextureManager,
  updateAudioGpuTexture,
  updateAudioStorageBuffer,
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
    expect(manager.getWidth()).toBe(4);
    expect(manager.getHeight()).toBe(2);

    const initialBuffer = manager.getBuffer();
    expect(initialBuffer.length).toBe(4 * 2 * 4);

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
    expect(data).toBe(initialBuffer); // Zero-copy buffer reference

    const version = texture.version;
    expect(
      Array.from(data.slice(0, 16).filter((_, index) => index % 4 === 0)),
    ).toEqual([10, 20, 30, 40]);

    manager.update(
      new Uint8Array([50, 60, 70, 80]),
      new Uint8Array([128, 128, 128, 128]),
    );

    expect(manager.getTexture()).toBe(texture);
    expect(texture.image.data).toBe(initialBuffer);
    expect(texture.version).toBeGreaterThan(version);
    expect(data[0]).toBe(50);
    expect(data[12]).toBe(80);
  });

  it('does not expose an uninitialized texture when audio samples are absent', () => {
    const manager = new SharedAudioGpuTextureManager(4);
    manager.update(new Uint8Array(), undefined);
    expect(manager.getTexture()).toBeNull();
  });

  it('updates WebGPU GPUTexture and GPUBuffer zero-copy passes', () => {
    const manager = new SharedAudioGpuTextureManager(4);
    manager.update(
      new Uint8Array([100, 150, 200, 250]),
      new Uint8Array([128, 130, 126, 128]),
    );

    let writeTextureCalled = false;
    let writeBufferCalled = false;

    const mockDevice = {
      queue: {
        writeTexture: (
          destination: { texture: unknown },
          data: Uint8Array,
          layout: { bytesPerRow: number; rowsPerImage: number },
          size: { width: number; height: number },
        ) => {
          writeTextureCalled = true;
          expect(destination.texture).toBe('mock-gpu-texture');
          expect(data).toBe(manager.getBuffer());
          expect(layout.bytesPerRow).toBe(4 * 4);
          expect(layout.rowsPerImage).toBe(2);
          expect(size.width).toBe(4);
          expect(size.height).toBe(2);
        },
        writeBuffer: (
          buffer: unknown,
          bufferOffset: number,
          data: ArrayBufferView,
        ) => {
          writeBufferCalled = true;
          expect(buffer).toBe('mock-gpu-buffer');
          expect(bufferOffset).toBe(0);
          expect(data).toBe(manager.getBuffer());
        },
      },
    } as unknown as GPUDevice;

    manager.writeToGpuTexture(
      mockDevice,
      'mock-gpu-texture' as unknown as GPUTexture,
    );
    expect(writeTextureCalled).toBe(true);

    manager.writeToStorageBuffer(
      mockDevice,
      'mock-gpu-buffer' as unknown as GPUBuffer,
    );
    expect(writeBufferCalled).toBe(true);

    let standaloneWriteTextureCalled = false;
    let standaloneWriteBufferCalled = false;
    const standaloneMockDevice = {
      queue: {
        writeTexture: (
          destination: { texture: unknown },
          data: Uint8Array,
          _layout: { bytesPerRow: number; rowsPerImage: number },
          _size: { width: number; height: number },
        ) => {
          standaloneWriteTextureCalled = true;
          expect(destination.texture).toBe('standalone-tex');
          expect(data).toBe(manager.getBuffer());
        },
        writeBuffer: (
          buffer: unknown,
          _bufferOffset: number,
          _data: ArrayBufferView,
        ) => {
          standaloneWriteBufferCalled = true;
          expect(buffer).toBe('standalone-buf');
        },
      },
    } as unknown as GPUDevice;

    updateAudioGpuTexture(
      standaloneMockDevice,
      'standalone-tex' as unknown as GPUTexture,
      manager.getBuffer(),
      4,
      2,
    );
    expect(standaloneWriteTextureCalled).toBe(true);

    updateAudioStorageBuffer(
      standaloneMockDevice,
      'standalone-buf' as unknown as GPUBuffer,
      manager.getBuffer(),
    );
    expect(standaloneWriteBufferCalled).toBe(true);
  });

  it('disposes shared audio texture cleanly', () => {
    const manager = new SharedAudioGpuTextureManager(4);
    manager.update(new Uint8Array([10, 20, 30, 40]), undefined);
    expect(manager.getTexture()).not.toBeNull();

    manager.dispose();
    expect(manager.getTexture()).toBeNull();
  });
});
