/**
 * Helpers to encode PCM audio into compact WAV data URLs for Clef Omni.
 * Clef Omni requires audio/wav or audio/mpeg, bounded to 2 MiB.
 */
import { DECISION_LIMITS } from '../decision-model.ts';

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encodes mono 16-bit PCM WAV at the specified sample rate.
 */
export function encodePcmToWav(
  samples: Float32Array,
  sampleRate = 16000,
): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * bytesPerSample, true); // ByteRate
  view.setUint16(32, bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Converts an ArrayBuffer to a base64 Data URL.
 */
export function wavToDataUrl(wavBuffer: ArrayBuffer): string {
  if (wavBuffer.byteLength > DECISION_LIMITS.audioBytes) {
    throw new Error('Audio buffer exceeds the 2 MiB decision limit.');
  }
  const bytes = new Uint8Array(wavBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    );
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Creates a synthetic sine wave WAV clip for offline testing and fallbacks.
 */
export function createSyntheticAudioClip(options?: {
  frequency?: number;
  durationMs?: number;
  sampleRate?: number;
}): string {
  const sampleRate = options?.sampleRate ?? 16000;
  const durationMs = options?.durationMs ?? 1000;
  const frequency = options?.frequency ?? 440;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * 0.5;
  }

  return wavToDataUrl(encodePcmToWav(samples, sampleRate));
}

/**
 * Captures a mono audio snippet from a MediaStream or AudioContext.
 */
export async function captureAudioSnippet(
  source: MediaStream | AudioContext,
  durationMs = 1500,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const boundedDuration = Math.min(Math.max(durationMs, 250), 3000);

  // If source is a MediaStream and MediaRecorder supports WAV (rare), or capture PCM via WebAudio
  const context =
    source instanceof AudioContext
      ? source
      : new (
          window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext: typeof AudioContext;
            }
          ).webkitAudioContext
        )();

  const closeCreatedContext = !(source instanceof AudioContext);

  try {
    const mediaStream =
      source instanceof MediaStream
        ? source
        : (context as unknown as { stream?: MediaStream }).stream;

    if (!mediaStream && !(source instanceof AudioContext)) {
      throw new Error('No audio stream available to record.');
    }

    const sourceNode = mediaStream
      ? context.createMediaStreamSource(mediaStream)
      : context.createBufferSource();

    // Use ScriptProcessorNode to capture PCM samples
    const bufferSize = 2048;
    const processor = context.createScriptProcessor(bufferSize, 1, 1);
    const recordedSamples: Float32Array[] = [];
    let totalSamples = 0;
    const targetSamples = Math.floor(
      (context.sampleRate * boundedDuration) / 1000,
    );

    return await new Promise<string>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        try {
          processor.disconnect();
          sourceNode.disconnect();
          if (closeCreatedContext && context.state !== 'closed') {
            void context.close();
          }
        } catch {
          // ignore cleanup issues
        }
      };

      const finish = (error?: Error, result?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else if (result) resolve(result);
      };

      signal?.addEventListener(
        'abort',
        () => finish(new Error('Audio capture cancelled.')),
        { once: true },
      );

      processor.onaudioprocess = (event) => {
        if (settled) return;
        const inputData = event.inputBuffer.getChannelData(0);
        recordedSamples.push(new Float32Array(inputData));
        totalSamples += inputData.length;

        if (totalSamples >= targetSamples) {
          try {
            // Concatenate samples
            const fullPcm = new Float32Array(totalSamples);
            let offset = 0;
            for (const chunk of recordedSamples) {
              fullPcm.set(chunk, offset);
              offset += chunk.length;
            }

            // Downsample to 16kHz if source is higher rate
            let finalSamples = fullPcm;
            const targetRate = 16000;
            if (context.sampleRate > targetRate) {
              const ratio = context.sampleRate / targetRate;
              const downsampledLength = Math.floor(fullPcm.length / ratio);
              const downsampled = new Float32Array(downsampledLength);
              for (let i = 0; i < downsampledLength; i++) {
                downsampled[i] = fullPcm[Math.floor(i * ratio)];
              }
              finalSamples = downsampled;
            }

            const wavBuffer = encodePcmToWav(
              finalSamples,
              Math.min(context.sampleRate, targetRate),
            );
            finish(undefined, wavToDataUrl(wavBuffer));
          } catch (err) {
            finish(
              err instanceof Error
                ? err
                : new Error('Failed to encode audio snippet.'),
            );
          }
        }
      };

      sourceNode.connect(processor);
      // Dummy destination to keep processor alive
      processor.connect(context.destination);

      // Watchdog
      setTimeout(() => {
        if (!settled) {
          finish(new Error('Audio capture timed out.'));
        }
      }, boundedDuration + 3000);
    });
  } catch (error) {
    if (closeCreatedContext && context.state !== 'closed') {
      void context.close().catch(() => {});
    }
    throw error;
  }
}
