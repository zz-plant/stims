/** Explicit, one-frame visual review. This never records or uploads audio. */
import type { DecisionResult } from '../core/decision-model.ts';

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
