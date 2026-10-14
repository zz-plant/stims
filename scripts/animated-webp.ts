/**
 * Shared animated-WebP encoder for the README clips
 * (`generate-readme-clips.ts`, `generate-workflow-demo.ts`).
 *
 * GIF stores up to 256 colours per frame, and a full-frame visualizer changes
 * almost every pixel, so file size grows roughly linearly with frame rate: the
 * workflow preview was 3.2 MB at 6 fps and 12 MB at 25 fps. Lossy WebP keeps
 * full colour, and the same capture at 25 fps encodes to about 2.6 MB.
 *
 * README clips autoplay in a loop with no warning, so the encoder refuses a
 * clip that breaks WCAG 2.3.1 (more than three flashes, or red flashes, in any
 * second), measured with flash-guard on the frames as encoded. A slow GIF hid
 * flashes by sampling below them: the 3x workflow preview read 7 a second at
 * 25 fps, and Krash's Cerebral Demons 10. The whole frame counts as the
 * screen, which is stricter than how a README displays it.
 */
import { createFlashFrameCounter } from 'flash-guard';
import sharp from 'sharp';

export async function writeAnimatedWebp(
  frames: string[],
  outPath: string,
  { fps, width }: { fps: number; width?: number },
) {
  const inputs =
    width === undefined
      ? frames
      : await Promise.all(
          frames.map((frame) =>
            sharp(frame).resize({ width }).png().toBuffer(),
          ),
        );
  await assertFlashSafe(inputs, fps);
  // A scalar delay only applies to the first frame; every frame needs one.
  const delay = frames.map(() => Math.round(1000 / fps));
  await sharp(inputs, { join: { animated: true } })
    .webp({ quality: 75, smartSubsample: true, effort: 4, loop: 0, delay })
    .toFile(outPath);
}

async function assertFlashSafe(inputs: (string | Buffer)[], fps: number) {
  let counter: ReturnType<typeof createFlashFrameCounter> | undefined;
  for (const input of inputs) {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    counter ??= createFlashFrameCounter({
      width: info.width,
      height: info.height,
      deltaMs: 1000 / fps,
    });
    counter.push(data);
  }
  const result = counter?.analyze();
  if (result && (result.exceedsThreshold || result.exceedsRedThreshold)) {
    throw new Error(
      `clip has ${result.peakFlashesPerSecond} flashes and ` +
        `${result.peakRedFlashesPerSecond} red flashes in its worst second; ` +
        'WCAG 2.3.1 allows 3 of each. Pick another preset, or lower the speed-up',
    );
  }
}
