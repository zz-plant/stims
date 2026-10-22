/** Explicit visual and motion review. Audio is only sent when explicitly requested. */
import {
  DECISION_LIMITS,
  type DecisionResult,
} from '../core/decision-model.ts';

export function summarizePromptMatch(
  result: DecisionResult,
): 'match' | 'mismatch' | 'uncertain' {
  if (result.task !== 'prompt-match' || result.disposition !== 'accepted')
    return 'uncertain';
  const evidence = result.answers.sufficient_evidence;
  if (evidence?.type !== 'noul' || evidence.noul < 0.8) return 'uncertain';
  const values = ['structure_match', 'palette_match', 'composition_match'].map(
    (key) => result.answers[key],
  );
  if (values.some((answer) => answer?.type !== 'noul')) return 'uncertain';
  if (values.some((answer) => answer?.type === 'noul' && answer.noul <= 0.2))
    return 'mismatch';
  return values.every((answer) => answer?.type === 'noul' && answer.noul >= 0.8)
    ? 'match'
    : 'uncertain';
}

/** Read within a frame, bounded if rendering stops while the panel is open. */
export async function captureDecisionImage(
  stage: HTMLElement | null,
  signal?: AbortSignal,
): Promise<string> {
  return captureCanvasDecisionImage(
    stage?.querySelector('canvas') ?? null,
    signal,
  );
}

export async function captureCanvasDecisionImage(
  canvas: HTMLCanvasElement | null,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!canvas || canvas.width <= 0 || canvas.height <= 0)
    return Promise.reject(new Error('The stage has no picture to check yet.'));
  return new Promise((resolve, reject) => {
    let frame = 0;
    let settled = false;
    const finish = (error?: Error, image?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else if (image) resolve(image);
    };
    const cancel = () => finish(new Error('Picture check cancelled.'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'The stage stopped rendering before the picture could be checked.',
          ),
        ),
      3000,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    frame = requestAnimationFrame(() => {
      try {
        signal?.throwIfAborted();
        const sample = document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
        sample.width = Math.max(1, Math.round(canvas.width * scale));
        sample.height = Math.max(1, Math.round(canvas.height * scale));
        const context = sample.getContext('2d');
        if (!context) throw new Error('The stage picture could not be read.');
        context.drawImage(canvas, 0, 0, sample.width, sample.height);
        const image = sample.toDataURL('image/jpeg', 0.85);
        if (!image.startsWith('data:image/jpeg;base64,'))
          throw new Error('The stage picture could not be encoded.');
        finish(undefined, image);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('The stage picture could not be read.'),
        );
      }
    });
  });
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** Record a short canvas clip for multimodal motion evaluation (Clef Omni). */
export async function captureDecisionVideo(
  stage: HTMLElement | null,
  options?: { durationMs?: number },
  signal?: AbortSignal,
): Promise<string> {
  return captureCanvasDecisionVideo(
    stage?.querySelector('canvas') ?? null,
    options,
    signal,
  );
}

export async function captureCanvasDecisionVideo(
  canvas: HTMLCanvasElement | null,
  options?: { durationMs?: number },
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await recordCanvasOnce(canvas, options, signal);
  } catch (error) {
    // The first MediaRecorder a page creates can hand back an empty file:
    // the VP8 encode pipeline is not warm yet, so every frame is dropped.
    // Measured in the failing e2e — the first recording in a session always
    // came back 0 bytes and the second always succeeded. One retry after an
    // empty recording, and only that outcome, turns the warm-up miss into
    // the recording the user asked for.
    if (
      error instanceof Error &&
      error.message === 'No animation frames were recorded.' &&
      !signal?.aborted
    ) {
      return recordCanvasOnce(canvas, options, signal);
    }
    throw error;
  }
}

async function recordCanvasOnce(
  canvas: HTMLCanvasElement | null,
  options?: { durationMs?: number },
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!canvas || canvas.width <= 0 || canvas.height <= 0)
    return Promise.reject(new Error('The stage has no picture to check yet.'));

  if (
    typeof MediaRecorder === 'undefined' ||
    typeof canvas.captureStream !== 'function'
  ) {
    throw new Error('Video recording is not supported in this browser.');
  }

  const supported = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
    (type) => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    },
  );
  if (!supported) {
    throw new Error('No supported video recording format available.');
  }
  const cleanMime: 'video/webm' | 'video/mp4' = supported.startsWith(
    'video/mp4',
  )
    ? 'video/mp4'
    : 'video/webm';

  const durationMs = Math.min(Math.max(options?.durationMs ?? 1500, 500), 4000);
  const stream = canvas.captureStream(15);

  return new Promise((resolve, reject) => {
    let settled = false;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: supported,
        videoBitsPerSecond: 1_200_000,
      });
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      return reject(
        error instanceof Error
          ? error
          : new Error('Failed to initialize video recorder.'),
      );
    }

    const chunks: Blob[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      for (const track of stream.getTracks()) track.stop();
    };

    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (result) resolve(result);
    };

    const cancel = () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // recorder may already be stopped
      }
      finish(new Error('Animation check cancelled.'));
    };

    signal?.addEventListener('abort', cancel, { once: true });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = () => {
      finish(new Error('Failed to record stage animation.'));
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: cleanMime });
        const buffer = await blob.arrayBuffer();
        if (buffer.byteLength > DECISION_LIMITS.videoBytes) {
          return finish(
            new Error('Recorded animation exceeded the size limit.'),
          );
        }
        if (buffer.byteLength === 0) {
          return finish(new Error('No animation frames were recorded.'));
        }
        const base64 = bufferToBase64(buffer);
        finish(undefined, `data:${cleanMime};base64,${base64}`);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Failed to process recorded animation.'),
        );
      }
    };

    // Watchdog timer: duration + 3000ms grace period
    const timer = setTimeout(() => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // no-op
      }
    }, durationMs + 3000);

    // Stop recorder after durationMs
    setTimeout(() => {
      try {
        if (recorder.state === 'recording') recorder.stop();
      } catch {
        // no-op
      }
    }, durationMs);

    try {
      recorder.start(100);
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error('Could not start stage animation recording.'),
      );
    }
  });
}
