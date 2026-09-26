import { beforeEach, describe, expect, test } from 'bun:test';
import { onRequest } from '../../functions/api/oembed.ts';
import { __resetPresetMetaForTest } from '../../functions/shared/preset-meta.ts';

// The iframe HTML this endpoint hands to Notion, Discord, and Ghost embeds
// corpus-derived titles — strings nobody curates, full of quotes and angle
// brackets. They must be escaped inside the HTML attributes, and the size
// params must never emit width="NaN".

type PresetMeta = Record<string, [title: string, author: string]>;

function makeContext(url: string, presetMeta?: PresetMeta) {
  return {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(presetMeta ?? {}), {
              status: presetMeta ? 200 : 404,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      },
    },
  };
}

async function embedFor(url: string, presetMeta?: PresetMeta) {
  const response = await onRequest(makeContext(url, presetMeta));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

const embedUrl = (target: string) =>
  `https://toil.fyi/api/oembed?url=${encodeURIComponent(target)}`;

describe('oEmbed provider', () => {
  beforeEach(__resetPresetMetaForTest);

  test('serves a rich embed with per-preset title and thumbnail', async () => {
    const { status, body } = await embedFor(
      embedUrl('https://toil.fyi/?preset=martin-wtf-track'),
      { 'martin-wtf-track': ['martin - "wtf" track', 'martin'] },
    );

    expect(status).toBe(200);
    expect(body.title).toBe('martin - "wtf" track by martin');
    expect(body.author_name).toBe('martin');
    expect(body.thumbnail_url).toBe(
      'https://toil.fyi/api/og-preset?id=martin-wtf-track',
    );
    expect(body.html).toContain(
      'src="https://toil.fyi/?preset=martin-wtf-track&amp;embed=true"',
    );
    expect(body.html).toContain(
      'title="martin - &quot;wtf&quot; track by martin"',
    );
  });

  test('escapes angle brackets in embed titles', async () => {
    const { body } = await embedFor(
      embedUrl('https://toil.fyi/?preset=angle'),
      {
        angle: ['flexi <broken> star', 'flexi'],
      },
    );

    expect(body.html).toContain('title="flexi &lt;broken&gt; star by flexi"');
  });

  test('falls back to site defaults when the url names no known preset', async () => {
    const { body } = await embedFor(embedUrl('https://toil.fyi/'), {
      'martin-wtf-track': ['martin - "wtf" track', 'martin'],
    });

    expect(body.title).toBe('Stims — MilkDrop-Inspired Audio Visualizer');
    expect(body.thumbnail_url).toBe('https://toil.fyi/og/milkdrop.png');
    expect(body.html).toContain('src="https://toil.fyi/?embed=true"');
  });

  test('clamps embed dimensions and rejects garbage values', async () => {
    const garbage = await embedFor(
      `${embedUrl('https://toil.fyi/')}&maxwidth=abc&maxheight=99999`,
    );
    expect(garbage.body.width).toBe(800);
    expect(garbage.body.height).toBe(720);

    const tiny = await embedFor(
      `${embedUrl('https://toil.fyi/')}&maxwidth=10&maxheight=10`,
    );
    expect(tiny.body.width).toBe(320);
    expect(tiny.body.height).toBe(240);
  });

  test('rejects a request without a url parameter', async () => {
    const { status } = await embedFor('https://toil.fyi/api/oembed');
    expect(status).toBe(400);
  });
});
