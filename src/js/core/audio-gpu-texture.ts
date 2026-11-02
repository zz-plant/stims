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
  const uint32Data = new Uint32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength >> 2,
  );

  // Row 0: Frequency data
  // Byte 0: val, Byte 1: val, Byte 2: 0, Byte 3: 255
  // Little-Endian 32-bit: (255 << 24) | (0 << 16) | (val << 8) | val = 0xff000000 | (val << 8) | val
  if (frequencyLength === width) {
    for (let x = 0; x < width; x += 1) {
      const val = frequencyData[x] ?? 0;
      uint32Data[x] = 0xff000000 | (val << 8) | val;
    }
  } else if (frequencyLength > 0) {
    const step = frequencyLength / width;
    for (let x = 0; x < width; x += 1) {
      const val = frequencyData[(x * step) | 0] ?? 0;
      uint32Data[x] = 0xff000000 | (val << 8) | val;
    }
  } else {
    uint32Data.fill(0xff000000, 0, width);
  }

  // Row 1: Waveform data
  // Byte 0: val, Byte 1: min(255, abs(val - 128) * 2), Byte 2: 0, Byte 3: 255
  // Little-Endian 32-bit: 0xff000000 | (mag << 8) | val
  if (waveformLength === width) {
    for (let x = 0; x < width; x += 1) {
      const val = waveformData[x] ?? 128;
      const diff = val - 128;
      const absDiff = diff < 0 ? -diff : diff;
      const mag = absDiff > 127 ? 255 : absDiff << 1;
      uint32Data[width + x] = 0xff000000 | (mag << 8) | val;
    }
  } else if (waveformLength > 0) {
    const step = waveformLength / width;
    for (let x = 0; x < width; x += 1) {
      const val = waveformData[(x * step) | 0] ?? 128;
      const diff = val - 128;
      const absDiff = diff < 0 ? -diff : diff;
      const mag = absDiff > 127 ? 255 : absDiff << 1;
      uint32Data[width + x] = 0xff000000 | (mag << 8) | val;
    }
  } else {
    uint32Data.fill(0xff000080, width, width * 2);
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
