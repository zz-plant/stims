import { describe, expect, test } from 'bun:test';
import { parseHostMessage } from '../../scripts/sync-room-worker.ts';
import { toVectorizeId } from '../../src/js/milkdrop/vectorize-id.ts';

describe('sync room host message parsing', () => {
  test('accepts a preset message and clamps field lengths', () => {
    const parsed = parseHostMessage(
      JSON.stringify({
        type: 'preset',
        presetId: 'geiss-casino',
        title: 'Casino',
      }),
    );
    expect(parsed).toEqual({ presetId: 'geiss-casino', title: 'Casino' });

    const long = parseHostMessage(
      JSON.stringify({ type: 'preset', presetId: 'x'.repeat(600) }),
    );
    expect(long?.presetId).toHaveLength(256);
    expect(long?.title).toBeNull();
  });

  test('rejects non-preset, malformed, and oversized frames', () => {
    expect(
      parseHostMessage(JSON.stringify({ type: 'peers', count: 3 })),
    ).toBeNull();
    expect(parseHostMessage('not json')).toBeNull();
    expect(parseHostMessage(12)).toBeNull();
    expect(parseHostMessage(JSON.stringify({ type: 'preset' }))).toBeNull();
    expect(
      parseHostMessage(`{"type":"preset","presetId":"${'y'.repeat(3000)}"}`),
    ).toBeNull();
  });
});

describe('vectorize id mapping', () => {
  test('short ids pass through unchanged', () => {
    expect(toVectorizeId('geiss-casino')).toBe('geiss-casino');
  });

  test('long ids compress to exactly 64 bytes and stay deterministic', () => {
    const long =
      '414-bowel-rebranding-pr-whore-skinned-to-the-teeth-shader-serial-killer-common-glut';
    const mapped = toVectorizeId(long);
    expect(new TextEncoder().encode(mapped).length).toBe(64);
    expect(toVectorizeId(long)).toBe(mapped);
    expect(mapped.startsWith(long.slice(0, 40))).toBe(true);
  });

  test('distinct long ids with a shared prefix stay distinct', () => {
    const base = 'z'.repeat(80);
    expect(toVectorizeId(`${base}-a`)).not.toBe(toVectorizeId(`${base}-b`));
  });
});
