import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import {
  encodeFlipbookGif,
  quantizePreviewFrame,
  validateFlipbook,
} from '../../src/js/utils/media/preview-flipbook.ts';

describe('social preview flipbooks', () => {
  test('round-trips multiple frames, palette and timing through a real GIF decoder', async () => {
    const width = 32;
    const height = 18;
    const rgba = (offset: number) =>
      Uint8Array.from({ length: width * height * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 17 + offset) % 256,
      );
    const frames = [
      quantizePreviewFrame(rgba(0)),
      quantizePreviewFrame(rgba(13)),
    ];
    const clip = { version: 1, width, height, delayMs: 500, frames };
    const gif = encodeFlipbookGif(validateFlipbook(clip));
    const decoded = sharp(gif, { animated: true });
    const metadata = await decoded.metadata();
    expect(metadata.format).toBe('gif');
    expect(metadata.pages).toBe(2);
    expect(metadata.pageHeight).toBe(height);
    expect(metadata.delay).toEqual([500, 500]);
    const { data } = await decoded
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(0);
    expect(data.subarray(0, width * height * 4)).not.toEqual(
      data.subarray(width * height * 4),
    );
    expect(data[width * height * 4 + 3]).toBe(255);
  });

  test('rejects invalid dimensions, timing, frame counts and decoded payload sizes', () => {
    const clip = {
      version: 1,
      width: 2,
      height: 2,
      delayMs: 500,
      frames: ['AAAAAA==', 'AQEBAQ=='],
    };
    expect(validateFlipbook(clip).frames).toHaveLength(2);
    for (const bad of [
      { ...clip, width: 321 },
      { ...clip, height: 181 },
      { ...clip, width: 1.5 },
      { ...clip, version: 2 },
      { ...clip, delayMs: 0 },
      { ...clip, delayMs: 501 },
      { ...clip, frames: [clip.frames[0]] },
      { ...clip, frames: Array(25).fill(clip.frames[0]) },
      { ...clip, frames: ['AA==', 'AA=='] },
      { ...clip, frames: ['!!!!', '!!!!'] },
    ])
      expect(() => validateFlipbook(bad)).toThrow();
  });

  test('refuses a flashing animation, including the transition back to its start', () => {
    const black = btoa('\0'.repeat(32 * 18));
    const white = btoa('\xff'.repeat(32 * 18));
    expect(() =>
      encodeFlipbookGif(
        validateFlipbook({
          version: 1,
          width: 32,
          height: 18,
          delayMs: 100,
          frames: Array.from({ length: 20 }, (_, i) => (i % 2 ? white : black)),
        }),
      ),
    ).toThrow(/flash/i);
  });
});
