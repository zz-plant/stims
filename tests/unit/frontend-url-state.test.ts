import { describe, expect, test } from 'bun:test';
import {
  buildCanonicalUrl,
  buildSessionRouteSearch,
  normalizeCollectionTag,
  parsePlainSearch,
  readSessionRouteState,
  stringifyPlainSearch,
} from '../../src/js/frontend/url-state.ts';

describe('frontend url state', () => {
  test('reads legacy query params into canonical session state', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/milkdrop/?experience=milkdrop&panel=looks&collection=cream-of-the-crop&audio=sample&preset=signal-bloom&agent=true',
    );

    expect(state).toEqual({
      presetId: 'signal-bloom',
      collectionTag: 'collection:cream-of-the-crop',
      panel: 'browse',
      audioSource: 'demo',
      agentMode: true,
      previewMode: false,
      invalidExperienceSlug: null,
      youtubeVideoId: null,
      youtubeStartSeconds: null,
    });
  });

  test('reads a shared YouTube video and start offset', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/?audio=youtube&yt=dQw4w9WgXcQ&t=42',
    );

    expect(state.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(state.youtubeStartSeconds).toBe(42);
  });

  test('rejects a malformed YouTube id rather than loading a broken embed', () => {
    const state = readSessionRouteState('https://toil.fyi/?yt=not-an-id');

    expect(state.youtubeVideoId).toBeNull();
  });

  test('round-trips the YouTube video through the canonical url', () => {
    const url = buildCanonicalUrl(
      {
        presetId: null,
        collectionTag: null,
        panel: null,
        audioSource: 'youtube',
        agentMode: false,
        youtubeVideoId: 'dQw4w9WgXcQ',
        youtubeStartSeconds: 42,
      },
      'https://toil.fyi/',
    );

    expect(url.searchParams.get('yt')).toBe('dQw4w9WgXcQ');
    expect(url.searchParams.get('t')).toBe('42');
    expect(readSessionRouteState(url.toString()).youtubeVideoId).toBe(
      'dQw4w9WgXcQ',
    );
  });

  test('omits a start offset when no video is set', () => {
    const search = buildSessionRouteSearch(
      {
        presetId: null,
        collectionTag: null,
        panel: null,
        audioSource: 'demo',
        agentMode: false,
        youtubeVideoId: null,
        youtubeStartSeconds: 42,
      },
      {},
    );

    expect(search.t).toBeUndefined();
    expect(search.yt).toBeUndefined();
  });

  test('normalizes supported panel and audio aliases', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/?tool=looks&audio=mic',
    );

    expect(state.panel).toBe('browse');
    expect(state.audioSource).toBe('microphone');
  });

  test('prefers canonical tool over legacy panel when both are present', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/?tool=settings&panel=looks',
    );

    expect(state.panel).toBe('settings');
  });

  test('normalizes canonical values case-insensitively', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/?tool=EDITOR&audio=YOUTUBE',
    );

    expect(state.panel).toBe('editor');
    expect(state.audioSource).toBe('youtube');
  });

  test('preserves the capture workspace in canonical urls', () => {
    const state = readSessionRouteState('https://toil.fyi/?tool=CAPTURE');
    expect(state.panel).toBe('capture');
  });

  test('preserves file audio route state in canonical session urls', () => {
    const state = readSessionRouteState('?audio=file');

    expect(state.audioSource).toBe('file');

    const search = stringifyPlainSearch(
      buildSessionRouteSearch(
        {
          presetId: null,
          collectionTag: null,
          panel: null,
          audioSource: 'file',
          agentMode: false,
          previewMode: false,
        },
        parsePlainSearch('?landing=1&audio=demo'),
      ),
    );

    expect(search).toBe('?landing=1&audio=file');

    const url = buildCanonicalUrl(
      {
        presetId: null,
        collectionTag: null,
        panel: null,
        audioSource: 'file',
        agentMode: false,
        previewMode: false,
      },
      'https://toil.fyi/milkdrop/?landing=1&audio=demo',
    );

    expect(url.pathname).toBe('/');
    expect(url.search).toBe('?landing=1&audio=file');
  });

  test('preserves unrelated query params while writing canonical urls', () => {
    const url = buildCanonicalUrl(
      {
        presetId: 'signal-bloom',
        collectionTag: 'collection:cream-of-the-crop',
        panel: 'settings',
        audioSource: 'demo',
        agentMode: true,
        previewMode: false,
      },
      'https://toil.fyi/milkdrop/?landing=1&experience=milkdrop',
    );

    expect(url.pathname).toBe('/');
    expect(url.search).toBe(
      '?landing=1&preset=signal-bloom&collection=collection%3Acream-of-the-crop&tool=settings&audio=demo&agent=true',
    );
  });

  test('drops legacy-only params after canonicalization', () => {
    const url = buildCanonicalUrl(
      {
        presetId: null,
        collectionTag: null,
        panel: null,
        audioSource: null,
        agentMode: false,
        previewMode: false,
      },
      'https://toil.fyi/milkdrop/?experience=seary&panel=browse&audio=demo',
    );

    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
  });

  test('normalizes collection tags consistently', () => {
    expect(normalizeCollectionTag('cream-of-the-crop')).toBe(
      'collection:cream-of-the-crop',
    );
    expect(normalizeCollectionTag('collection:classic-milkdrop')).toBe(
      'collection:classic-milkdrop',
    );
    expect(normalizeCollectionTag('   ')).toBeNull();
  });

  test('parses and rewrites plain search params without json encoding', () => {
    expect(parsePlainSearch('?landing=1&agent=true')).toEqual({
      landing: '1',
      agent: 'true',
    });

    expect(
      stringifyPlainSearch(
        buildSessionRouteSearch(
          {
            presetId: 'signal-bloom',
            collectionTag: null,
            panel: null,
            audioSource: null,
            agentMode: true,
            previewMode: false,
          },
          parsePlainSearch('?landing=1&experience=milkdrop'),
        ),
      ),
    ).toBe('?landing=1&preset=signal-bloom&agent=true');
  });

  test('parses and writes embedded preview mode', () => {
    const state = readSessionRouteState(
      'https://toil.fyi/?agent=true&embedded=true&preset=signal-bloom',
    );

    expect(state.previewMode).toBe(true);

    const search = stringifyPlainSearch(
      buildSessionRouteSearch(
        {
          presetId: 'signal-bloom',
          collectionTag: null,
          panel: null,
          audioSource: 'demo',
          agentMode: true,
          previewMode: true,
        },
        {},
      ),
    );

    expect(search).toBe(
      '?preset=signal-bloom&audio=demo&agent=true&embedded=true',
    );
  });

  test('encodes and decodes preset source code in url hash fragments', () => {
    const {
      buildPresetCodeHash,
      decodePresetCodeFromHash,
    } = require('../../src/js/frontend/url-state.ts');
    const milkSource = '[preset00]\nfRating=5.000\nwave_r=0.5';
    const hash = buildPresetCodeHash(milkSource);

    expect(hash).toContain('#code=');
    const decoded = decodePresetCodeFromHash(hash);
    expect(decoded).toBe(milkSource);
  });
});
