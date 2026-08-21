import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequest as middlewareRequest } from '../../functions/_middleware.ts';
import {
  buildPresetOgSvg,
  fitByline,
  fitTitle,
  normalizePresetId,
  onRequest as ogPresetRequest,
  type RenderAssets,
} from '../../functions/api/og-preset.ts';
import { presentTitle } from '../../functions/shared/preset-title.ts';
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
      expect(svg).toContain('STIMS');
      expect(svg).toContain('toil.fyi');
      expect(svg).toContain('CREAM OF THE CROP');
    });

    test('drops the author prefix the corpus stores in the title', () => {
      const svg = buildPresetOgSvg({
        id: 'rovastar-parallel-universe',
        title: 'Rovastar - Parallel Universe',
        author: 'Rovastar',
      });

      expect(svg).toContain('>Parallel Universe<');
      expect(svg).not.toContain('>Rovastar - Parallel Universe<');
      expect(svg).toContain('by Rovastar');
    });

    test('collapses slug-derived delimiter chains in the title', () => {
      expect(
        presentTitle('Eos - Ether - Posession - Phat - Edit', 'Eo.S.'),
      ).toBe('Eos Ether Posession Phat Edit');
    });

    test('wraps a long title onto two lines rather than shrinking it flat', () => {
      const short = fitTitle('Parallel Universe');
      expect(short.lines).toHaveLength(1);

      const long = fitTitle(
        'crystal palace schizotoxin the wild iris bloom 16 iterations',
      );
      expect(long.lines).toHaveLength(2);
      expect(long.size).toBeGreaterThanOrEqual(40);
      expect(long.lines.join(' ')).toBe(
        'crystal palace schizotoxin the wild iris bloom 16 iterations',
      );
    });

    // Corpus names carry underscore- and paren-delimited runs with no spaces,
    // which word wrapping alone cannot fit.
    test('hard-breaks a single word too long for one line', () => {
      const { size, lines } = fitTitle(
        'triptrap_(getting_concrete_visions_through_a_diafragma_version)',
      );
      const maxChars = Math.floor(1072 / (size * 0.55));

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(maxChars);
      }
      expect(lines.join('')).toContain('triptrap_(getting');
    });

    test('ellipsizes a title that cannot fit in two lines', () => {
      const { lines } = fitTitle('x'.repeat(400));

      expect(lines).toHaveLength(2);
      expect(lines[1].endsWith('…')).toBe(true);
    });

    // 60 corpus authors run past 40 characters; the longest is 94, and the
    // brand lockup sits on the byline's own baseline.
    test('truncates a byline before it reaches the brand lockup', () => {
      const long =
        'The NG + Stahlregen & Boz + EoS + Geiss + Phat + Rovastar + Zylot + Flexi + martin + Fishbrain';
      const fitted = fitByline(long);

      expect(fitted.length).toBeLessThan(long.length);
      expect(fitted.endsWith('…')).toBe(true);
      // "by " + the byline must clear the right-aligned "STIMS · toil.fyi".
      const bylineWidth = `by ${fitted}`.length * 25 * 0.52;
      expect(bylineWidth).toBeLessThanOrEqual(
        1200 - 64 * 2 - 16 * 19 * 0.6 - 40,
      );
    });

    test('leaves a byline that already fits untouched', () => {
      expect(fitByline('Rovastar')).toBe('Rovastar');
    });

    test('renders the preset frame full-bleed when a preview exists', () => {
      const svg = buildPresetOgSvg({
        id: 'rovastar-parallel-universe',
        title: 'Parallel Universe',
        previewImageUri: 'data:image/png;base64,AAAA',
      });

      expect(svg).toContain(
        '<image href="data:image/png;base64,AAAA" x="0" y="0" width="1200" height="630"',
      );
    });

    test('carries no animation the rasterizer cannot draw', () => {
      const svg = buildPresetOgSvg({
        id: 'rovastar-parallel-universe',
        title: 'Parallel Universe',
      });

      expect(svg).not.toContain('@keyframes');
      expect(svg).not.toContain('animation:');
    });

    // Space Mono has no U+25B6; the previous card shipped a literal tofu box
    // in its call to action.
    test('uses only glyphs the bundled fonts can shape', () => {
      const svg = buildPresetOgSvg({
        id: 'rovastar-parallel-universe',
        title: 'Parallel Universe',
        author: 'Rovastar',
      });
      const text = svg.replace(/<[^>]*>/g, '');
      expect(text).not.toMatch(/[\u25a0-\u25ff\u2190-\u21ff]/);
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
          new Uint8Array(
            readFileSync(join(repoRoot, 'public', 'og', 'fonts', name)),
          ),
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

    // Regression: previews are excluded from the deploy bundle and served
    // from R2 by functions/milkdrop-presets/previews. Reading them back
    // through ASSETS returned the SPA shell at status 200, so production
    // rendered the no-preview branch for every shared preset.
    test('reads the preset frame from the R2 bucket, not the assets binding', async () => {
      const previewPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
      const requestedKeys: string[] = [];
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe&format=svg',
      );
      const response = await ogPresetRequest({
        request,
        env: {
          STATIC_R2: {
            get: async (key: string) => {
              requestedKeys.push(key);
              return {
                arrayBuffer: async () => previewPng.buffer as ArrayBuffer,
              };
            },
          },
        },
      });

      expect(requestedKeys).toEqual([
        'milkdrop-presets/previews/rovastar-parallel-universe.png',
      ]);
      expect(await response.text()).toContain(
        '<image href="data:image/png;base64,',
      );
    });

    test('ignores an assets response that is not an image', async () => {
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe&format=svg',
      );
      const response = await ogPresetRequest({
        request,
        env: {
          ASSETS: {
            fetch: async () =>
              new Response('<!doctype html><html>app shell</html>', {
                headers: { 'Content-Type': 'text/html' },
              }),
          },
        },
      });

      expect(await response.text()).not.toContain('<image href=');
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

    test('returns a client error for malformed encoded preset paths', async () => {
      const context = {
        request: new Request('https://toil.fyi/preset/%E0%A4%A'),
        next: async () => new Response('unexpected'),
      };

      const res = await middlewareRequest(context);
      expect(res.status).toBe(400);
    });
  });
});
