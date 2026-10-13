/**
 * Shared animated-WebP encoder for the README clips
 * (`generate-readme-clips.ts`, `generate-workflow-demo.ts`).
 *
 * GIF stores up to 256 colours per frame, and a full-frame visualizer changes
 * almost every pixel, so file size grows roughly linearly with frame rate: the
 * workflow preview was 3.2 MB at 6 fps and 12 MB at 25 fps. Lossy WebP keeps
 * full colour, and the same capture at 25 fps encodes to about 2.6 MB.
 */
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
  // A scalar delay only applies to the first frame; every frame needs one.
  const delay = frames.map(() => Math.round(1000 / fps));
  await sharp(inputs, { join: { animated: true } })
    .webp({ quality: 75, smartSubsample: true, effort: 4, loop: 0, delay })
    .toFile(outPath);
}
