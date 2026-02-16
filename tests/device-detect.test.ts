import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getSmartTvModeOverride,
  isMobileDevice,
  isSmartTvDevice,
} from '../assets/js/utils/device-detect';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: unknown;
};

type NavSnapshot = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentData: unknown;
  deviceMemory: number;
  innerWidth: number;
  innerHeight: number;
};

const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36';

const mobileMatchMedia = ((query: string) =>
  ({
    media: query,
    matches: query === '(pointer: coarse)' || query === '(hover: none)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

const desktopMatchMedia = ((query: string) =>
  ({
    media: query,
    matches: query === '(hover: hover)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

const tvMatchMedia = ((query: string) =>
  ({
    media: query,
    matches:
      query === '(hover: none)' ||
      query === '(pointer: coarse)' ||
      query === '(any-pointer: coarse)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

let snapshot: NavSnapshot;
let originalMatchMedia: typeof window.matchMedia;

function setNavigatorField<K extends keyof NavSnapshot>(
  key: K,
  value: NavSnapshot[K],
) {
  Object.defineProperty(navigator, key, {
    value,
    configurable: true,
  });
}

describe('isMobileDevice', () => {
  beforeEach(() => {
    snapshot = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgentData: (navigator as NavigatorWithUserAgentData).userAgentData,
      deviceMemory:
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
    originalMatchMedia = window.matchMedia;

    setNavigatorField('userAgent', DESKTOP_UA);
    setNavigatorField('platform', 'Linux x86_64');
    setNavigatorField('maxTouchPoints', 0);
    setNavigatorField('deviceMemory', 8);
    setNavigatorField('userAgentData', undefined);
    window.matchMedia = desktopMatchMedia;
    window.localStorage.removeItem('stims:tv-mode');
  });

  afterEach(() => {
    setNavigatorField('userAgent', snapshot.userAgent);
    setNavigatorField('platform', snapshot.platform);
    setNavigatorField('maxTouchPoints', snapshot.maxTouchPoints);
    setNavigatorField('userAgentData', snapshot.userAgentData);
    setNavigatorField('deviceMemory', snapshot.deviceMemory);
    window.matchMedia = originalMatchMedia;
    window.localStorage.removeItem('stims:tv-mode');
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: snapshot.innerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: snapshot.innerHeight,
    });
  });

  test('detects mobile from user agent data mobile hint', () => {
    setNavigatorField('userAgentData', {
      brands: [],
      mobile: true,
      platform: 'Android',
      getHighEntropyValues: async () => ({}),
      toJSON: () => ({}),
    });

    expect(isMobileDevice()).toBe(true);
  });

  test('detects iPadOS masquerading as Mac when touch points are present', () => {
    setNavigatorField('platform', 'MacIntel');
    setNavigatorField('maxTouchPoints', 5);

    expect(isMobileDevice()).toBe(true);
  });

  test('detects contemporary touch devices when user agent is desktop-like', () => {
    setNavigatorField('maxTouchPoints', 5);
    window.matchMedia = mobileMatchMedia;

    expect(isMobileDevice()).toBe(true);
  });

  test('keeps desktop devices classified as non-mobile', () => {
    expect(isMobileDevice()).toBe(false);
  });
});

describe('isSmartTvDevice', () => {
  beforeEach(() => {
    snapshot = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgentData: (navigator as NavigatorWithUserAgentData).userAgentData,
      deviceMemory:
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
    originalMatchMedia = window.matchMedia;
    setNavigatorField('userAgent', DESKTOP_UA);
    setNavigatorField('platform', 'Linux x86_64');
    setNavigatorField('maxTouchPoints', 0);
    setNavigatorField('deviceMemory', 8);
    window.matchMedia = desktopMatchMedia;
    window.localStorage.removeItem('stims:tv-mode');
  });

  afterEach(() => {
    setNavigatorField('userAgent', snapshot.userAgent);
    setNavigatorField('platform', snapshot.platform);
    setNavigatorField('maxTouchPoints', snapshot.maxTouchPoints);
    setNavigatorField('userAgentData', snapshot.userAgentData);
    setNavigatorField('deviceMemory', snapshot.deviceMemory);
    window.matchMedia = originalMatchMedia;
    window.localStorage.removeItem('stims:tv-mode');
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: snapshot.innerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: snapshot.innerHeight,
    });
  });

  test('detects smart tv user agents', () => {
    setNavigatorField(
      'userAgent',
      'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36',
    );

    expect(isSmartTvDevice()).toBe(true);
  });

  test('detects likely leanback devices using input + power heuristics', () => {
    window.matchMedia = tvMatchMedia;
    setNavigatorField('deviceMemory', 2);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 1080,
    });

    expect(isSmartTvDevice()).toBe(true);
  });

  test('supports query override for tv mode and persists it', () => {
    window.localStorage.setItem('stims:tv-mode', 'on');

    expect(getSmartTvModeOverride()).toBe('on');
    expect(window.localStorage.getItem('stims:tv-mode')).toBe('on');
    expect(isSmartTvDevice()).toBe(true);
  });

  test('supports query override to disable tv mode', () => {
    window.localStorage.setItem('stims:tv-mode', 'off');

    expect(getSmartTvModeOverride()).toBe('off');
    expect(isSmartTvDevice()).toBe(false);
  });

  test('keeps desktop user agents out of tv mode by default', () => {
    expect(isSmartTvDevice()).toBe(false);
  });
});
