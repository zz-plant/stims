import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { checkpointFlipbook } from '../../scripts/checkpoint-flipbook.ts';

describe('thumbnail checkpoint reuse', () => {
  test('retains real sampled pixels and holds them until the next checkpoint', async () => {
    const image = async (red: number) =>
      `data:image/png;base64,${(
        await sharp({
          create: {
            width: 192,
            height: 108,
            channels: 3,
            background: { r: red, g: 30, b: 50 },
          },
        })
          .png()
          .toBuffer()
      ).toString('base64')}`;
    const first = await image(32);
    const last = await image(64);
    const clip = await checkpointFlipbook(
      [
        { frame: 15, image: first },
        { frame: 75, image: last },
      ],
      15,
    );
    expect(clip.delayMs).toBe(200);
    expect(clip.frames.length).toBe(6);
    expect(clip.frames[0]).toBe(clip.frames[1]);
    expect(clip.frames.at(-1)).not.toBe(clip.frames[0]);
    expect(clip.width).toBe(192);
  });
});
