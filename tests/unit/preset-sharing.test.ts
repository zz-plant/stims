import { describe, expect, test } from 'bun:test';
import {
  buildPresetLink,
  formatPresetShareCopy,
} from '../../assets/js/utils/share-link.ts';
import { onRequest as middlewareRequest } from '../../functions/_middleware.ts';
import {
  buildPresetOgSvg,
  onRequest as ogPresetRequest,
} from '../../functions/api/og-preset.ts';

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

    test('og-preset Cloudflare function returns SVG response', async () => {
      const request = new Request(
        'https://toil.fyi/api/og-preset?id=rovastar-parallel-universe',
      );
      const response = await ogPresetRequest({ request });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/svg+xml');
      const text = await response.text();
      expect(text).toContain('Parallel Universe');
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
