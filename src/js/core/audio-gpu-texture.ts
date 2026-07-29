import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

/**
 * Shared audio GPU texture
 *
 * Row 0 contains frequency samples and row 1 contains waveform samples. A
 * Three.js DataTexture is deliberately used instead of a backend-specific
 * WebGLTexture so the same long-lived allocation can be uploaded by either
 * the WebGL or WebGPU renderer.
 */

export interface SharedAudioTextureBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

const EMPTY_AUDIO_SAMPLES = new Uint8Array();

function writeAudioTextureBuffer(
  frequencyData: Uint8Array,
  waveformData: Uint8Array,
  data: Uint8Array,
  width: number,
) {
  const frequencyLength = frequencyData.length;
  const waveformLength = waveformData.length;

  for (let x = 0; x < width; x += 1) {
    const sourceIndex =
      frequencyLength > 0 ? Math.floor((x / width) * frequencyLength) : 0;
    const value = frequencyData[sourceIndex] ?? 0;
    const offset = x * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  }

  const waveformRowOffset = width * 4;
  for (let x = 0; x < width; x += 1) {
    const sourceIndex =
      waveformLength > 0 ? Math.floor((x / width) * waveformLength) : 0;
    const value = waveformData[sourceIndex] ?? 128;
    const offset = waveformRowOffset + x * 4;
    data[offset] = value;
    data[offset + 1] = Math.min(255, Math.abs(value - 128) * 2);
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  }
}

export function createAudioTextureBuffer(
  frequencyData: Uint8Array,
  waveformData: Uint8Array,
  targetWidth = 512,
  targetData?: Uint8Array,
): SharedAudioTextureBuffer {
  const height = 2;
  const requiredLength = targetWidth * height * 4;
  const data =
    targetData?.length === requiredLength
      ? targetData
      : new Uint8Array(requiredLength);
  writeAudioTextureBuffer(frequencyData, waveformData, data, targetWidth);
  return { width: targetWidth, height, data };
}

export class SharedAudioGpuTextureManager {
  private readonly width: number;
  private readonly height = 2;
  private readonly data: Uint8Array;
  private texture: DataTexture | null = null;

  constructor(width = 512) {
    this.width = width;
    this.data = new Uint8Array(width * 2 * 4);
  }

  update(
    frequencyData: Uint8Array,
    waveformData: Uint8Array | undefined,
  ): void {
    if (
      frequencyData.length === 0 &&
      (!waveformData || waveformData.length === 0)
    ) {
      return;
    }
    createAudioTextureBuffer(
      frequencyData,
      waveformData ?? EMPTY_AUDIO_SAMPLES,
      this.width,
      this.data,
    );
    if (!this.texture) {
      this.texture = new DataTexture(
        this.data,
        this.width,
        2,
        RGBAFormat,
        UnsignedByteType,
      );
      this.texture.wrapS = ClampToEdgeWrapping;
      this.texture.wrapT = ClampToEdgeWrapping;
      this.texture.minFilter = LinearFilter;
      this.texture.magFilter = LinearFilter;
      this.texture.generateMipmaps = false;
      this.texture.flipY = false;
      this.texture.name = 'stims-shared-audio';
    }
    this.texture.needsUpdate = true;
  }

  getTexture(): DataTexture | null {
    return this.texture;
  }

  getBuffer(): Uint8Array {
    return this.data;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  writeToGpuTexture(device: GPUDevice, gpuTexture: GPUTexture): void {
    updateAudioGpuTexture(
      device,
      gpuTexture,
      this.data,
      this.width,
      this.height,
    );
  }

  writeToStorageBuffer(device: GPUDevice, buffer: GPUBuffer): void {
    updateAudioStorageBuffer(device, buffer, this.data);
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
  }
}

export function updateAudioStorageBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: ArrayBufferView,
): void {
  device.queue.writeBuffer(buffer, 0, data);
}

export function updateAudioGpuTexture(
  device: GPUDevice,
  texture: GPUTexture,
  data: Uint8Array,
  width: number,
  height = 2,
): void {
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
}
