import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isMobileDevice } from '../assets/js/utils/device-detect';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: unknown;
};

type NavSnapshot = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentData: unknown;
};

const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36';

const mobileMatchMedia = ((query: string) =>
  ({
    media: query,
    matches: query === '(pointer: coarse)',
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
    };
    originalMatchMedia = window.matchMedia;

    setNavigatorField('userAgent', DESKTOP_UA);
    setNavigatorField('platform', 'Linux x86_64');
    setNavigatorField('maxTouchPoints', 0);
    setNavigatorField('userAgentData', undefined);
    window.matchMedia = desktopMatchMedia;
  });

  afterEach(() => {
    setNavigatorField('userAgent', snapshot.userAgent);
    setNavigatorField('platform', snapshot.platform);
    setNavigatorField('maxTouchPoints', snapshot.maxTouchPoints);
    setNavigatorField('userAgentData', snapshot.userAgentData);
    window.matchMedia = originalMatchMedia;
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
