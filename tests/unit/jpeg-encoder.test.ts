import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import {
  encodeJpeg,
  encodeJpegWithin,
} from '../../functions/shared/jpeg-encoder.ts';

// Every assertion decodes through sharp (libjpeg-turbo), so a stream only
// this encoder could read would fail here, not in an unfurler.
async function decode(jpeg: Uint8Array) {
  const { data, info } = await sharp(jpeg)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function rgba(
  width: number,
  height: number,
  colour: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels.set([...colour(x, y), 255], p);
    }
  }
  return pixels;
}

function meanAbsoluteError(source: Uint8Array, decoded: Buffer): number {
  let total = 0;
  for (let i = 0, j = 0; i < source.length; i += 4, j += 3) {
    total +=
      Math.abs(source[i] - decoded[j]) +
      Math.abs(source[i + 1] - decoded[j + 1]) +
      Math.abs(source[i + 2] - decoded[j + 2]);
  }
  return total / ((source.length / 4) * 3);
}

describe('baseline JPEG encoder', () => {
  test('decodes to the source, including the partial edge blocks', async () => {
    // 37x21 is not a multiple of 8 in either direction.
    const width = 37;
    const height = 21;
    const source = rgba(width, height, (x, y) => [
      (x * 7) % 256,
      (y * 12) % 256,
      x > 18 ? 230 : 40,
    ]);
    const decoded = await decode(encodeJpeg(source, width, height, 95));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(meanAbsoluteError(source, decoded.data)).toBeLessThan(3);
  });

  test('keeps colour at full resolution next to a sharp edge', async () => {
    // One-pixel coral and blue columns: subsampled chroma would average them
    // into a grey-purple and miss by ~70 levels.
    const width = 32;
    const height = 16;
    const source = rgba(width, height, (x) =>
      x % 2 ? [244, 122, 84] : [40, 80, 220],
    );
    const decoded = await decode(encodeJpeg(source, width, height, 95));
    expect(meanAbsoluteError(source, decoded.data)).toBeLessThan(8);
  });

  test('survives noise that puts 0xFF bytes in the scan', async () => {
    // Pseudo-random noise at quality 100 maximizes code lengths and makes
    // 0xFF data bytes, each of which must be stuffed.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % 256;
    };
    const width = 64;
    const height = 48;
    const source = rgba(width, height, () => [next(), next(), next()]);
    const jpeg = encodeJpeg(source, width, height, 100);
    let stuffed = 0;
    for (let i = 0; i < jpeg.length - 1; i++) {
      if (jpeg[i] === 0xff && jpeg[i + 1] === 0x00) stuffed++;
    }
    expect(stuffed).toBeGreaterThan(0);
    const decoded = await decode(jpeg);
    expect(meanAbsoluteError(source, decoded.data)).toBeLessThan(4);
  });

  test('steps down to the first quality that fits the budget', async () => {
    const width = 64;
    const height = 48;
    const source = rgba(width, height, (x, y) => [
      (x * x + y * 3) % 256,
      (x * y) % 256,
      (y * y) % 256,
    ]);
    const best = encodeJpeg(source, width, height, 95);
    const lower = encodeJpeg(source, width, height, 50);
    expect(lower.length).toBeLessThan(best.length);

    const fitted = encodeJpegWithin(source, width, height, {
      maxBytes: best.length - 1,
      qualities: [95, 50],
    });
    expect(fitted).toEqual(lower);

    const roomy = encodeJpegWithin(source, width, height, {
      maxBytes: best.length,
      qualities: [95, 50],
    });
    expect(roomy).toEqual(best);
  });

  test('returns the smallest attempt when no quality fits', async () => {
    const width = 16;
    const height = 16;
    const source = rgba(width, height, (x, y) => [x * 16, y * 16, 128]);
    const jpeg = encodeJpegWithin(source, width, height, {
      maxBytes: 0,
      qualities: [90, 40],
    });
    expect(jpeg).toEqual(encodeJpeg(source, width, height, 40));
    expect((await decode(jpeg)).width).toBe(width);
  });
});
