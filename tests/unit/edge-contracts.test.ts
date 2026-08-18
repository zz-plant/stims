import { describe, expect, test } from 'bun:test';
import {
  type OEmbedResponse,
  OEmbedResponseSchema,
  SyncRoomCreateResponseSchema,
  type TelemetryEvent,
  TelemetryEventSchema,
  VisualSearchEmbedResponseSchema,
  VisualSearchMatchSchema,
  VisualSearchRequestSchema,
  type VisualSearchResponse,
  VisualSearchResponseSchema,
} from '../../src/js/core/edge-contracts.ts';

describe('edge-contracts validators', () => {
  test('VisualSearchRequestSchema accepts a valid description', () => {
    expect(
      VisualSearchRequestSchema.parse({ description: 'glowing plasma' }),
    ).toEqual({ description: 'glowing plasma' });
    expect(
      VisualSearchRequestSchema.parse({
        description: 'glowing plasma',
        embedOnly: true,
      }),
    ).toEqual({ description: 'glowing plasma', embedOnly: true });
  });

  test('VisualSearchRequestSchema rejects short or missing descriptions', () => {
    expect(() =>
      VisualSearchRequestSchema.parse({ description: 'ab' }),
    ).toThrow();
    expect(() => VisualSearchRequestSchema.parse({})).toThrow();
    expect(() =>
      VisualSearchRequestSchema.parse({ description: 42 }),
    ).toThrow();
  });

  test('VisualSearchResponseSchema parses results and preserves an optional source', () => {
    const body: VisualSearchResponse = {
      results: [
        { presetId: 'rovastar-parallel-universe', score: 0.92 },
        { presetId: 'eos-glowsticks-v2-03-music', score: 0.87 },
      ],
      source: 'vectorize',
    };
    expect(VisualSearchResponseSchema.parse(body)).toEqual(body);

    const noSource = { results: [{ presetId: 'a', score: 1 }] };
    expect(VisualSearchResponseSchema.parse(noSource)).toEqual(noSource);
  });

  test('VisualSearchResponseSchema rejects malformed results', () => {
    expect(() =>
      VisualSearchResponseSchema.parse({ results: 'nope' }),
    ).toThrow();
    expect(() =>
      VisualSearchResponseSchema.parse({
        results: [{ presetId: 'a' }],
      }),
    ).toThrow();
    expect(() =>
      VisualSearchResponseSchema.parse({
        results: [],
        source: 'pinecone',
      }),
    ).toThrow();
  });

  test('VisualSearchMatchSchema rejects non-numeric scores', () => {
    expect(() =>
      VisualSearchMatchSchema.parse({ presetId: 'a', score: 'high' }),
    ).toThrow();
  });

  test('VisualSearchEmbedResponseSchema rejects non-numeric embeddings', () => {
    expect(
      VisualSearchEmbedResponseSchema.parse({ embedding: [0.1, 0.2, 0.3] })
        .embedding,
    ).toHaveLength(3);
    expect(() =>
      VisualSearchEmbedResponseSchema.parse({ embedding: [0.1, 'x'] }),
    ).toThrow();
  });

  test('TelemetryEventSchema requires an event and validates optionals', () => {
    const event: TelemetryEvent = {
      event: 'webgl-context-lost',
      renderer: 'webgl2',
      fps: 30,
      audioLatencyMs: 12,
      presetId: 'rovastar-parallel-universe',
      userAgent: 'test',
    };
    expect(TelemetryEventSchema.parse(event)).toEqual(event);

    expect(() => TelemetryEventSchema.parse({})).toThrow();
    expect(() =>
      TelemetryEventSchema.parse({ event: '', renderer: 'directx' }),
    ).toThrow();
  });

  test('SyncRoomCreateResponseSchema requires room and hostKey', () => {
    expect(
      SyncRoomCreateResponseSchema.parse({ room: 'abc', hostKey: 'xyz' }),
    ).toEqual({ room: 'abc', hostKey: 'xyz' });
    expect(() => SyncRoomCreateResponseSchema.parse({ room: '' })).toThrow();
    const parsed = SyncRoomCreateResponseSchema.safeParse({
      room: 1,
      hostKey: 'x',
    });
    expect(parsed.success).toBe(false);
  });

  test('OEmbedResponseSchema accepts a full rich response', () => {
    const embed: OEmbedResponse = {
      type: 'rich',
      version: '1.0',
      title: 'Stims',
      author_name: 'Stims',
      author_url: 'https://toil.fyi',
      provider_name: 'Stims',
      provider_url: 'https://toil.fyi',
      cache_age: 86400,
      thumbnail_url: 'https://toil.fyi/og/milkdrop.png',
      thumbnail_width: 1200,
      thumbnail_height: 630,
      html: '<iframe src="https://toil.fyi"></iframe>',
      width: 800,
      height: 450,
    };
    expect(OEmbedResponseSchema.parse(embed)).toEqual(embed);
    expect(() =>
      OEmbedResponseSchema.parse({ ...embed, type: 'photo' }),
    ).toThrow();
    expect(() =>
      OEmbedResponseSchema.parse({ ...embed, width: 'wide' }),
    ).toThrow();
  });

  test('safeParse surfaces success and failure without throwing', () => {
    const ok = VisualSearchResponseSchema.safeParse({
      results: [{ presetId: 'a', score: 0.5 }],
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.results[0].presetId).toBe('a');
    }

    const bad = VisualSearchResponseSchema.safeParse({ results: null });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error).toBeInstanceOf(Error);
    }
  });
});
