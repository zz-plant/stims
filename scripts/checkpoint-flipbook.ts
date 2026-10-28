/** Reuses thumbnail checkpoints as a small, approximately timed flipbook. */
import sharp from 'sharp';
import {
  PREVIEW_DELAY_MS,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  quantizePreviewFrame,
  validateFlipbook,
} from '../src/js/utils/media/preview-flipbook.ts';

export async function checkpointFlipbook(
  checkpoints: { frame: number; image: string }[],
  bestFrame: number,
) {
  if (checkpoints.length < 2)
    throw new Error('Not enough thumbnail checkpoints for motion.');
  const bestIndex = Math.max(
    0,
    checkpoints.findIndex((sample) => sample.frame === bestFrame),
  );
  const samples = checkpoints.slice(Math.max(0, bestIndex - 1));
  if (samples.length < 2)
    throw new Error('Not enough checkpoints after the best frame.');
  const start = samples[0].frame;
  const count = Math.min(
    20,
    Math.max(
      5,
      Math.floor((samples[samples.length - 1].frame - start) / 12) + 1,
    ),
  );
  const encoded = await Promise.all(
    samples.map(async (sample) => {
      const data = Buffer.from(sample.image.split(',')[1], 'base64');
      const rgba = await sharp(data)
        .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT)
        .ensureAlpha()
        .raw()
        .toBuffer();
      return quantizePreviewFrame(rgba);
    }),
  );
  const frames = Array.from({ length: count }, (_, index) => {
    const target = start + index * 12;
    let sampleIndex = 0;
    for (let i = 1; i < samples.length && samples[i].frame <= target; i++)
      sampleIndex = i;
    return encoded[sampleIndex];
  });
  return validateFlipbook({
    version: 1,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    delayMs: PREVIEW_DELAY_MS,
    frames,
  });
}
