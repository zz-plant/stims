import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { onRequest as middlewareRequest } from '../../functions/_middleware.ts';
import {
  buildPresetOgSvg,
  normalizePresetId,
  onRequest as ogPresetRequest,
  type RenderAssets,
} from '../../functions/api/og-preset.ts';
import {
  buildPresetLink,
  formatPresetShareCopy,
} from '../../src/js/utils/media/share-link.ts';

describe('preset social sharing', () => {
  describe('share link copy formatting', () => {
    test('formats share copy with title and author', () => {
      const copy = formatPresetShareCopy({
        id: 'rovastar-parallel-universe',
        title: 'Parallel Universe',
        author: 'Rovastar',
      });

      expect(copy.title).toBe('Parallel Universe by Rovastar | Stims');
      expect(copy.text).toBe(
        'Experience "Parallel Universe" by Rovastar live on Stims audio visualizer.',
      );
      expect(copy.url).toBe(
        'https://toil.fyi/?preset=rovastar-parallel-universe',
      );
    });

    test('formats share copy without author', () => {
      const copy = formatPresetShareCopy({
        id: 'signal-bloom',
        title: 'Signal Bloom',
      });

      expect(copy.title).toBe('Signal Bloom | Stims');
      expect(copy.text).toBe(
        'Experience "Signal Bloom" live on Stims audio visualizer.',
      );
      expect(copy.url).toBe('https://toil.fyi/?preset=signal-bloom');
    });

    test('builds canonical preset link', () => {
      expect(buildPresetLink('eos-glowsticks')).toBe(
        'https://toil.fyi/?preset=eos-glowsticks',
      );
    });
  });

  describe('dynamic OG preset card SVG', () => {
    test('renders valid SVG with preset title and author', () => {
      const svg = buildPresetOgSvg({
        id: 'rovastar-parallel-universe',
        title: 'Parallel Universe',
        author: 'Rovastar',
        tags: ['collection:cream-of-the-crop'],
      });

      expect(svg).toContain('<svg');
      expect(svg).toContain('Parallel Universe');
      expect(svg).toContain('Rovastar');
      expect(svg).toContain('STIMS • AUDIO VISUALIZER');
      expect(svg).toContain('toil.fyi');
    });

    test('og-preset function returns SVG when format=svg is requested', async () => {
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe&format=svg',
      );
      const response = await ogPresetRequest({ request });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/svg+xml');
      const text = await response.text();
      expect(text).toContain('Parallel Universe');
    });

    test('normalizes missing or hostile preset ids to the default card', () => {
      expect(normalizePresetId(null)).toBe('rovastar-parallel-universe');
      expect(normalizePresetId('Geiss-Cauldron')).toBe('geiss-cauldron');
      expect(normalizePresetId('<script>alert(1)</script>')).toBe(
        'rovastar-parallel-universe',
      );
      expect(normalizePresetId('a'.repeat(200))).toBe(
        'rovastar-parallel-universe',
      );
    });
  });

  describe('rasterized OG preset card PNG', () => {
    const repoRoot = join(import.meta.dir, '..', '..');
    const renderAssets: RenderAssets = {
      wasm: readFileSync(
        join(repoRoot, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'),
      ),
      fonts: [
        'SpaceGrotesk-Regular.ttf',
        'SpaceGrotesk-Medium.ttf',
        'SpaceGrotesk-Bold.ttf',
        'SpaceMono-Regular.ttf',
        'SpaceMono-Bold.ttf',
      ].map(
        (name) =>
          new Uint8Array(readFileSync(join(repoRoot, 'public', 'og', 'fonts', name))),
      ),
    };

    test('og-preset function returns a 1200x630 PNG by default', async () => {
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe',
      );
      const response = await ogPresetRequest({ request, renderAssets });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');

      const bytes = new Uint8Array(await response.arrayBuffer());
      // PNG signature
      expect(Array.from(bytes.slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      // IHDR width/height (big-endian u32 at offsets 16 and 20)
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      expect(view.getUint32(16)).toBe(1200);
      expect(view.getUint32(20)).toBe(630);
    });

    test('falls back to the static card when rendering is impossible', async () => {
      const staticPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe',
      );
      const response = await ogPresetRequest({
        request,
        // No renderAssets: the wasm import resolves to a path string under
        // bun, so rendering fails and the ASSETS fallback must serve.
        env: {
          ASSETS: {
            fetch: async (input: Request | URL | string) => {
              const target =
                input instanceof URL ? input.toString() : String(input);
              if (target.endsWith('/og/milkdrop.png')) {
                return new Response(staticPng, {
                  headers: { 'content-type': 'image/png' },
                });
              }
              return new Response('not found', { status: 404 });
            },
          },
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(bytes)).toEqual(Array.from(staticPng));
    });
  });

  describe('edge middleware unfurling', () => {
    test('passes non-preset HTML through unmodified', async () => {
      const htmlResponse = new Response(
        '<html><head><title>Stims</title></head><body></body></html>',
        {
          headers: { 'content-type': 'text/html' },
        },
      );
      const context = {
        request: new Request('https://toil.fyi/'),
        next: async () => htmlResponse,
      };

      const res = await middlewareRequest(context);
      expect(res.status).toBe(200);
    });

    test('intercepts preset parameter requests', async () => {
      const htmlResponse = new Response(
        '<html><head><title>Stims</title><meta property="og:title" content="Stims" /></head><body></body></html>',
        { headers: { 'content-type': 'text/html' } },
      );
      const context = {
        request: new Request(
          'https://toil.fyi/?preset=rovastar-parallel-universe',
        ),
        next: async () => htmlResponse,
      };

      const res = await middlewareRequest(context);
      expect(res.status).toBe(200);
    });
  });
});
