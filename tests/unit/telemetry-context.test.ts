import { afterEach, describe, expect, test } from 'bun:test';
import { buildCrashTelemetryTransmitPayload } from '../../src/js/core/services/crash-telemetry.ts';
import {
  classifyTelemetryArrival,
  classifyTelemetryEngine,
  classifyTelemetryViewport,
  readTelemetryContext,
  resetTelemetryContextForTests,
  setTelemetryAudioSource,
} from '../../src/js/core/services/telemetry-context.ts';
import { resetDeviceDetectCache } from '../../src/js/utils/browser/device-detect.ts';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.5938.153 Mobile Safari/537.36';
const SAMSUNG_INTERNET =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const FIREFOX_ANDROID =
  'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IOS_FIREFOX =
  'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const LINUX_OPERA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 OPR/102.0.0.0';

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

describe('readTelemetryContext fold', () => {
  const target = window as unknown as { viewport?: unknown };
  const original = target.viewport;

  afterEach(() => {
    target.viewport = original;
  });

  test('says nothing on a flat screen', () => {
    target.viewport = {
      segments: [{ x: 0, y: 0, width: 390, height: 844 }],
    };
    expect(readTelemetryContext()).not.toHaveProperty('fold');
  });

  test('reports the hinge dividing the window when it fires', () => {
    target.viewport = {
      segments: [
        { x: 0, y: 0, width: 465, height: 585 },
        { x: 485, y: 0, width: 466, height: 585 },
      ],
    };
    expect(readTelemetryContext().fold).toBe('book');
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

describe('classifyTelemetryEngine', () => {
  test('reads Chrome on Android as Chromium, not as a WebView', () => {
    expect(classifyTelemetryEngine(ANDROID_CHROME)).toEqual({
      engine: 'chromium',
      engineMajor: 130,
    });
  });

  test('flags an Android WebView and reads its Chrome token, not Version/4.0', () => {
    expect(classifyTelemetryEngine(ANDROID_WEBVIEW)).toEqual({
      engine: 'chromium',
      engineMajor: 117,
      androidWebView: true,
    });
  });

  test("reads the engine under a browser's own version", () => {
    expect(classifyTelemetryEngine(SAMSUNG_INTERNET)).toEqual({
      engine: 'chromium',
      engineMajor: 121,
    });
    expect(classifyTelemetryEngine(WINDOWS_EDGE)).toEqual({
      engine: 'chromium',
      engineMajor: 131,
    });
    expect(classifyTelemetryEngine(LINUX_OPERA)).toEqual({
      engine: 'chromium',
      engineMajor: 116,
    });
  });

  test('reads Firefox as Gecko, and "like Gecko" as nothing', () => {
    expect(classifyTelemetryEngine(FIREFOX_ANDROID)).toEqual({
      engine: 'gecko',
      engineMajor: 128,
    });
    expect(classifyTelemetryEngine(FIREFOX_WINDOWS)).toEqual({
      engine: 'gecko',
      engineMajor: 132,
    });
    expect(classifyTelemetryEngine(MAC_SAFARI).engine).toBe('webkit');
  });

  test('reads Safari by its Version token', () => {
    expect(classifyTelemetryEngine(IOS_SAFARI)).toEqual({
      engine: 'webkit',
      engineMajor: 17,
    });
    expect(classifyTelemetryEngine(MAC_SAFARI)).toEqual({
      engine: 'webkit',
      engineMajor: 18,
    });
  });

  test('reads other iOS browsers as WebKit at the OS version, not their own', () => {
    expect(classifyTelemetryEngine(IOS_CHROME)).toEqual({
      engine: 'webkit',
      engineMajor: 16,
    });
    expect(classifyTelemetryEngine(IOS_FIREFOX)).toEqual({
      engine: 'webkit',
      engineMajor: 15,
    });
  });

  test('reports no version for a user agent it cannot place', () => {
    expect(classifyTelemetryEngine('')).toEqual({ engine: 'other' });
    expect(classifyTelemetryEngine('curl/8.6.0')).toEqual({ engine: 'other' });
    expect(classifyTelemetryEngine('Chrome/99999.0')).toEqual({
      engine: 'chromium',
    });
  });
});

describe('the OS and engine a beacon carries', () => {
  const fields = ['userAgent', 'platform', 'maxTouchPoints'] as const;
  const original = fields.map((field) => [field, navigator[field]] as const);

  const visitFrom = (
    userAgent: string,
    platform: string,
    maxTouchPoints = 0,
  ) => {
    const values = { userAgent, platform, maxTouchPoints };
    for (const field of fields) {
      Object.defineProperty(navigator, field, {
        value: values[field],
        configurable: true,
      });
    }
    resetDeviceDetectCache();
    resetTelemetryContextForTests();
  };

  afterEach(() => {
    for (const [field, value] of original) {
      Object.defineProperty(navigator, field, { value, configurable: true });
    }
    resetDeviceDetectCache();
  });

  test.each([
    [ANDROID_CHROME, 'Linux armv81', 5, 'android', 'chromium', 130],
    [SAMSUNG_INTERNET, 'Linux armv81', 5, 'android', 'chromium', 121],
    [FIREFOX_ANDROID, 'Linux aarch64', 5, 'android', 'gecko', 128],
    [IOS_SAFARI, 'iPhone', 5, 'ios', 'webkit', 17],
    [IOS_CHROME, 'iPhone', 5, 'ios', 'webkit', 16],
    // iPadOS presents itself as a Mac; only its touch points give it away.
    [MAC_SAFARI, 'MacIntel', 5, 'ios', 'webkit', 18],
    [MAC_SAFARI, 'MacIntel', 0, 'macos', 'webkit', 18],
    [WINDOWS_EDGE, 'Win32', 0, 'windows', 'chromium', 131],
    [FIREFOX_WINDOWS, 'Win32', 0, 'windows', 'gecko', 132],
    [LINUX_OPERA, 'Linux x86_64', 0, 'linux', 'chromium', 116],
  ] as const)(
    '%s on %s with %d touch points',
    (userAgent, platform, touchPoints, os, engine, engineMajor) => {
      visitFrom(userAgent, platform, touchPoints);
      expect(readTelemetryContext()).toMatchObject({
        os,
        engine,
        engineMajor,
      });
    },
  );

  test('carries the WebView flag only inside a WebView', () => {
    visitFrom(ANDROID_WEBVIEW, 'Linux armv81', 5);
    expect(readTelemetryContext()).toMatchObject({
      os: 'android',
      androidWebView: true,
    });

    visitFrom(ANDROID_CHROME, 'Linux armv81', 5);
    expect(readTelemetryContext()).not.toHaveProperty('androidWebView');
  });

  test('never carries the user agent, on a crash beacon either', () => {
    visitFrom(ANDROID_WEBVIEW, 'Linux armv81', 5);
    const payload = buildCrashTelemetryTransmitPayload({
      type: 'manual',
      timestamp: 1,
      iso: '1970-01-01T00:00:00.001Z',
      message: 'boom',
    });

    expect(payload).toMatchObject({ os: 'android', engineMajor: 117 });
    const sent = JSON.stringify(payload);
    for (const fragment of [
      'Mozilla',
      'Pixel 7',
      'TQ3A',
      'Android 13',
      '5938',
    ]) {
      expect(sent).not.toContain(fragment);
    }
  });
});
