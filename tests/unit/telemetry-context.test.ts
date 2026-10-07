import { afterEach, describe, expect, test } from 'bun:test';
import {
  classifyTelemetryArrival,
  classifyTelemetryViewport,
  readTelemetryContext,
  resetTelemetryContextForTests,
  setTelemetryAudioSource,
} from '../../src/js/core/services/telemetry-context.ts';

afterEach(() => {
  resetTelemetryContextForTests();
});

describe('classifyTelemetryViewport', () => {
  test('files a phone held upright as a portrait phone', () => {
    expect(classifyTelemetryViewport(390, 844, true)).toEqual({
      orientation: 'portrait',
      device: 'phone',
    });
  });

  test('keeps a phone a phone when it is turned sideways', () => {
    expect(classifyTelemetryViewport(844, 390, true)).toEqual({
      orientation: 'landscape',
      device: 'phone',
    });
  });

  test('separates tablets from phones by the short side', () => {
    expect(classifyTelemetryViewport(1024, 768, true)).toEqual({
      orientation: 'landscape',
      device: 'tablet',
    });
  });

  test('treats a near-square screen as square', () => {
    expect(classifyTelemetryViewport(800, 780, false)).toEqual({
      orientation: 'square',
      device: 'desktop',
    });
  });

  test('does not file a narrow desktop window as a phone', () => {
    expect(classifyTelemetryViewport(390, 844, false)).toEqual({
      orientation: 'portrait',
      device: 'desktop',
    });
  });

  test('reports nothing for a viewport with no size', () => {
    expect(classifyTelemetryViewport(0, 0, true)).toEqual({});
  });
});

describe('setTelemetryAudioSource', () => {
  test('reports the live source, and none once it stops', () => {
    setTelemetryAudioSource('microphone');
    expect(readTelemetryContext().audioSource).toBe('microphone');
    setTelemetryAudioSource(null);
    expect(readTelemetryContext().audioSource).toBe('none');
  });

  test('never passes an unknown source through', () => {
    setTelemetryAudioSource('spotify');
    expect(readTelemetryContext().audioSource).toBe('none');
  });
});

describe('classifyTelemetryArrival', () => {
  const own = 'https://toil.fyi';

  test('files web search results pages as search, under any country domain', () => {
    for (const referrer of [
      'https://www.google.com/',
      'https://www.google.co.uk/',
      'https://www.bing.com/',
      'https://duckduckgo.com/',
      'https://search.yahoo.com/',
      'https://search.brave.com/',
      'https://yandex.ru/',
    ]) {
      expect(classifyTelemetryArrival(referrer, own)).toBe('search');
    }
  });

  test('does not file other Google products as search', () => {
    expect(classifyTelemetryArrival('https://mail.google.com/', own)).toBe(
      'other',
    );
    expect(classifyTelemetryArrival('https://gemini.google.com/', own)).toBe(
      'assistant',
    );
  });

  test('keeps chat assistants, social sites and our own pages apart', () => {
    expect(classifyTelemetryArrival('https://chatgpt.com/', own)).toBe(
      'assistant',
    );
    expect(classifyTelemetryArrival('https://www.perplexity.ai/', own)).toBe(
      'assistant',
    );
    expect(classifyTelemetryArrival('https://old.reddit.com/', own)).toBe(
      'social',
    );
    expect(
      classifyTelemetryArrival('https://news.ycombinator.com/item?id=1', own),
    ).toBe('social');
    expect(classifyTelemetryArrival('https://toil.fyi/learn/', own)).toBe(
      'internal',
    );
    expect(classifyTelemetryArrival('https://example.org/blog', own)).toBe(
      'other',
    );
  });

  test('reports no referrer as none and an unparseable one as other', () => {
    expect(classifyTelemetryArrival('', own)).toBe('none');
    expect(classifyTelemetryArrival('not a url', own)).toBe('other');
  });
});
