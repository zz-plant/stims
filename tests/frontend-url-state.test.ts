import { describe, expect, test } from 'bun:test';
import {
  buildCanonicalUrl,
  normalizeCollectionTag,
  readSessionRouteState,
} from '../assets/js/frontend/url-state.ts';

describe('frontend url state', () => {
  test('reads legacy query params into canonical session state', () => {
    const state = readSessionRouteState(
      'https://no.toil.fyi/milkdrop/?experience=milkdrop&panel=looks&collection=cream-of-the-crop&audio=sample&preset=signal-bloom&agent=true',
    );

    expect(state).toEqual({
      presetId: 'signal-bloom',
      collectionTag: 'collection:cream-of-the-crop',
      panel: 'browse',
      audioSource: 'demo',
      agentMode: true,
      invalidExperienceSlug: null,
    });
  });

  test('flags unsupported legacy experience slugs', () => {
    const state = readSessionRouteState(
      'https://no.toil.fyi/milkdrop/?experience=non-existent-toy',
    );

    expect(state.invalidExperienceSlug).toBe('non-existent-toy');
  });

  test('normalizes supported panel and audio aliases', () => {
    const state = readSessionRouteState(
      'https://no.toil.fyi/?tool=inspect&audio=mic',
    );

    expect(state.panel).toBe('inspector');
    expect(state.audioSource).toBe('microphone');
  });

  test('preserves unrelated query params while writing canonical urls', () => {
    const url = buildCanonicalUrl(
      {
        presetId: 'signal-bloom',
        collectionTag: 'collection:cream-of-the-crop',
        panel: 'settings',
        audioSource: 'demo',
        agentMode: true,
        invalidExperienceSlug: null,
      },
      'https://no.toil.fyi/milkdrop/?landing=1&experience=milkdrop',
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
        invalidExperienceSlug: 'seary',
      },
      'https://no.toil.fyi/milkdrop/?experience=seary&panel=browse&audio=demo',
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
});
