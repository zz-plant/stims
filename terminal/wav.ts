import { readFileSync } from 'node:fs';

export interface WavFile {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float64Array;
  duration: number;
  totalSamples: number;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    (buf[off]! |
      (buf[off + 1]! << 8) |
      (buf[off + 2]! << 16) |
      (buf[off + 3]! << 24)) >>>
    0
  );
}

function readU16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

function parseWav(buf: Uint8Array): WavFile {
  if (buf.length < 44) throw new Error('Not a WAV file (too short)');
  if (String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!) !== 'RIFF') {
    throw new Error('Not a WAV file (missing RIFF header)');
  }
  if (String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!) !== 'WAVE') {
    throw new Error('Not a WAV file (missing WAVE marker)');
  }

  let sampleRate = 44100;
  let channels = 1;
  let bitsPerSample = 16;
  let samples = new Float64Array(0);

  let offset = 12;
  while (offset < buf.length - 8) {
    const id = String.fromCharCode(
      buf[offset]!,
      buf[offset + 1]!,
      buf[offset + 2]!,
      buf[offset + 3]!,
    );
    const size = readU32(buf, offset + 4);
    offset += 8;

    if (id === 'fmt ') {
      channels = readU16(buf, offset + 2) || 1;
      sampleRate = readU32(buf, offset + 4);
      bitsPerSample = readU16(buf, offset + 14) || 16;
    }

    if (id === 'data') {
      const byteCount = Math.min(size, buf.length - offset);
      const sampleCount = Math.floor(
        byteCount / (bitsPerSample / 8) / channels,
      );
      samples = new Float64Array(sampleCount);
      const bytes = bitsPerSample / 8;

      for (let i = 0; i < sampleCount; i++) {
        let sample = 0;
        for (let c = 0; c < channels; c++) {
          const idx = offset + (i * channels + c) * bytes;
          if (idx + bytes > buf.length) break;
          let val = 0;
          for (let b = 0; b < bytes; b++) {
            val |= buf[idx + b]! << (b * 8);
          }
          if (val & (1 << (bytes * 8 - 1))) {
            val |= -1 << (bytes * 8);
          }
          sample += val;
        }
        samples[i] = sample / channels / (1 << (bitsPerSample - 1));
      }
    }

    offset += size;
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    samples,
    duration: samples.length / sampleRate,
    totalSamples: samples.length,
  };
}

export function readWav(path: string): WavFile {
  const raw = readFileSync(path);
  const buf = new Uint8Array(raw);
  return parseWav(buf);
}

export async function readWavFromStdin(): Promise<WavFile> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return parseWav(buf);
}
