import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { onRequest } from '../../functions/_middleware.ts';
import { loadPresetFlipbook } from '../../functions/shared/flipbook-store.ts';

const id = 'a'.repeat(64);
const record = {
  version: 1,
  id,
  title: 'Draft </script><script>alert(1)</script>',
  presetId: 'shifter-curlique',
  source: '[preset00]\nzoom=1\n// </script>',
  width: 192,
  height: 108,
  delayMs: 200,
  frameCount: 20,
  videoReady: true,
};
const shell =
  '<html><head><title>Stims</title><link rel="canonical" href="https://toil.fyi/"><meta property="og:title" content="Stims"><meta property="og:url" content="https://toil.fyi/"><meta property="og:image" content="https://toil.fyi/og/milkdrop.png"><meta name="robots" content="index,follow"></head><body><div id="app"></div></body></html>';

function context(path: string, enabled = 'true') {
  const html = () =>
    new Response(shell, { headers: { 'content-type': 'text/html' } });
  return {
    request: new Request(`https://toil.fyi${path}`),
    next: async () => html(),
    env: {
      VIDEO_PREVIEWS_ENABLED: enabled,
      HOMEPAGE_VIDEO_PRESET: 'shifter-curlique',
      ASSETS: { fetch: async () => html() },
      STATIC_R2: {
        get: async (key: string) =>
          key === `flipbooks/${id}.json`
            ? {
                size: 500,
                json: async () => record,
                arrayBuffer: async () => new ArrayBuffer(0),
              }
            : key === 'flipbooks/presets/shifter-curlique.json'
              ? {
                  size: 100,
                  json: async () => ({ id }),
                  arrayBuffer: async () => new ArrayBuffer(0),
                }
              : null,
        put: async () => {},
      },
    },
  };
}

describe('video share metadata', () => {
  test('serves crawlable video and an inert source payload on the public URL', async () => {
    const response = await onRequest(context(`/s/${id}`));
    expect(response.status).toBe(200);
    const window = new Window();
    window.document.write(await response.text());
    const doc = window.document;
    expect(
      doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe(`https://toil.fyi/s/${id}`);
    expect(
      doc
        .querySelector('meta[property="og:video:type"]')
        ?.getAttribute('content'),
    ).toBe('video/mp4');
    expect(
      doc.querySelector('meta[property="og:video"]')?.getAttribute('content'),
    ).toBe(`https://toil.fyi/api/flipbooks/${id}.mp4`);
    expect(
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    ).toBe(`https://toil.fyi/api/flipbooks/${id}.jpg`);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(
      JSON.parse(doc.querySelector('script')?.textContent ?? '{}').source,
    ).toBe(record.source);
    expect(
      doc.querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex,follow');
    await window.happyDOM.close();
  });

  test('adds homepage video only after enabling transformations and publishing its pointer', async () => {
    const enabled = await (await onRequest(context('/'))).text();
    expect(enabled).toContain('og:video');
    const disabled = await (await onRequest(context('/', 'false'))).text();
    expect(disabled).not.toContain('og:video');
    const missing = context('/');
    missing.env.HOMEPAGE_VIDEO_PRESET = 'missing';
    expect(await (await onRequest(missing)).text()).not.toContain('og:video');
  });

  test('unknown or deleted public links return a real 404', async () => {
    expect((await onRequest(context(`/s/${'b'.repeat(64)}`))).status).toBe(404);
  });

  test('legacy records without a completed MP4 retain only the image preview', async () => {
    const request = context(`/s/${id}`);
    const original = request.env.STATIC_R2.get;
    request.env.STATIC_R2.get = async (key: string) => {
      const object = await original(key);
      if (key !== `flipbooks/${id}.json` || !object) return object;
      return {
        ...object,
        json: async () => ({ ...record, videoReady: false }),
      };
    };
    const html = await (await onRequest(request)).text();
    expect(html).not.toContain('og:video');
    expect(html).toContain(`/api/flipbooks/${id}.jpg`);
  });

  describe('homepage clip lookup', () => {
    const countingEnv = (failFirst = 0) => {
      const base = context('/').env;
      const keys: string[] = [];
      let failures = failFirst;
      const bucket = {
        ...base.STATIC_R2,
        get: async (key: string) => {
          keys.push(key);
          if (failures > 0) {
            failures -= 1;
            throw new Error('R2 unavailable');
          }
          return base.STATIC_R2.get(key);
        },
      };
      return { env: { ...base, STATIC_R2: bucket }, keys };
    };

    test('reads R2 once per few minutes, not on every request', async () => {
      const { env, keys } = countingEnv();
      const start = 1_000_000;
      for (const offset of [0, 1_000, 60_000]) {
        expect(
          (await loadPresetFlipbook(env, 'shifter-curlique', start + offset))
            ?.id,
        ).toBe(id);
      }
      expect(keys).toEqual([
        'flipbooks/presets/shifter-curlique.json',
        `flipbooks/${id}.json`,
      ]);

      await loadPresetFlipbook(env, 'shifter-curlique', start + 10 * 60_000);
      expect(keys).toHaveLength(4);
    });

    test('a failed read is retried on the next request', async () => {
      const { env, keys } = countingEnv(1);
      expect(await loadPresetFlipbook(env, 'shifter-curlique', 0)).toBeNull();
      expect((await loadPresetFlipbook(env, 'shifter-curlique', 1))?.id).toBe(
        id,
      );
      expect(keys).toHaveLength(3);
    });

    test('a failed record read behind a good pointer is retried too', async () => {
      const { env, keys } = countingEnv();
      const original = env.STATIC_R2.get;
      let failRecord = true;
      env.STATIC_R2.get = async (key: string) => {
        if (key === `flipbooks/${id}.json` && failRecord) {
          failRecord = false;
          keys.push(key);
          throw new Error('R2 unavailable');
        }
        return original(key);
      };
      expect(await loadPresetFlipbook(env, 'shifter-curlique', 0)).toBeNull();
      expect((await loadPresetFlipbook(env, 'shifter-curlique', 1))?.id).toBe(
        id,
      );
    });
  });
});
