import { getBrowserStorage } from '../../core/state/browser-storage.ts';
import { getSmartTvOverride } from '../../core/url-params.ts';

type NavigatorWithUserAgentData = {
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
  };
  platform?: string;
  maxTouchPoints?: number;
  userAgent?: string;
  deviceMemory?: number;
};

export type BrowserFamily =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'safari'
  | 'samsung-internet'
  | 'other';

export type PlatformFamily =
  | 'android'
  | 'ios'
  | 'linux'
  | 'macos'
  | 'windows'
  | 'other';

export type DeviceEnvironmentProfile = {
  isMobile: boolean;
  browserFamily: BrowserFamily;
  platformFamily: PlatformFamily;
};

const SMART_TV_OVERRIDE_STORAGE_KEY = 'stims:tv-mode';

const SMART_TV_UA_PATTERN =
  /(smart-tv|smarttv|hbbtv|appletv|googletv|android tv|aftb|aftt|aftm|tizen|web0s|webos|viera|netcast|roku|bravia|xbox|playstation)/i;

type SmartTvOverride = 'on' | 'off' | 'auto';

function parseSmartTvOverride(value: string | null): SmartTvOverride | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'enabled', 'tv'].includes(normalized)) {
    return 'on';
  }
  if (['0', 'false', 'off', 'disabled', 'desktop'].includes(normalized)) {
    return 'off';
  }
  if (['auto', 'default', 'system'].includes(normalized)) {
    return 'auto';
  }
  return null;
}

function persistSmartTvOverride(override: SmartTvOverride | null) {
  const storage = getBrowserStorage();
  if (!storage) return;
  if (!override || override === 'auto') {
    storage.removeItem(SMART_TV_OVERRIDE_STORAGE_KEY);
    return;
  }
  storage.setItem(SMART_TV_OVERRIDE_STORAGE_KEY, override);
}

export function getSmartTvModeOverride(): SmartTvOverride | null {
  if (typeof window !== 'undefined') {
    const tvParam = getSmartTvOverride();
    const queryOverride = parseSmartTvOverride(tvParam);
    if (queryOverride) {
      persistSmartTvOverride(queryOverride);
      return queryOverride;
    }
  }

  const storedOverride =
    getBrowserStorage()?.getItem(SMART_TV_OVERRIDE_STORAGE_KEY) ?? null;
  return parseSmartTvOverride(storedOverride);
}

const hasNoHoverPrimaryPointer = () => {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(hover: none)').matches;
};

function hasCoarsePrimaryPointer() {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(any-pointer: coarse)').matches
  );
}

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;

  const nav = navigator as NavigatorWithUserAgentData;
  if (nav.userAgentData?.mobile) return true;

  const userAgent = nav.userAgent ?? '';
  if (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    )
  ) {
    return true;
  }

  const platform = nav.platform ?? '';
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  if (platform === 'MacIntel' && maxTouchPoints > 1) {
    return true;
  }

  const userAgentPlatform = nav.userAgentData?.platform ?? '';
  if (
    maxTouchPoints > 0 &&
    /android|ios|iphone|ipad|ipod/i.test(userAgentPlatform)
  ) {
    return true;
  }

  if (maxTouchPoints > 0 && hasCoarsePrimaryPointer()) {
    return true;
  }

  return false;
}

export function getDeviceEnvironmentProfile(): DeviceEnvironmentProfile {
  if (typeof navigator === 'undefined') {
    return {
      isMobile: false,
      browserFamily: 'other',
      platformFamily: 'other',
    };
  }

  const nav = navigator as NavigatorWithUserAgentData;
  const userAgent = nav.userAgent ?? '';
  const lowerUserAgent = userAgent.toLowerCase();
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const reportedPlatform = `${nav.platform ?? ''} ${
    nav.userAgentData?.platform ?? ''
  }`.toLowerCase();
  const isIPadDesktopMask = nav.platform === 'MacIntel' && maxTouchPoints > 1;

  const platformFamily: PlatformFamily =
    /android/.test(lowerUserAgent) || /android/.test(reportedPlatform)
      ? 'android'
      : /iphone|ipad|ipod/.test(lowerUserAgent) ||
          /ios|iphone|ipad|ipod/.test(reportedPlatform) ||
          isIPadDesktopMask
        ? 'ios'
        : /mac/.test(reportedPlatform)
          ? 'macos'
          : /win/.test(reportedPlatform)
            ? 'windows'
            : /linux|x11/.test(reportedPlatform) ||
                /linux|x11/.test(lowerUserAgent)
              ? 'linux'
              : 'other';

  const browserFamily: BrowserFamily = lowerUserAgent.includes(
    'samsungbrowser/',
  )
    ? 'samsung-internet'
    : lowerUserAgent.includes('edg/') ||
        lowerUserAgent.includes('edga/') ||
        lowerUserAgent.includes('edgios/')
      ? 'edge'
      : lowerUserAgent.includes('firefox/') || lowerUserAgent.includes('fxios/')
        ? 'firefox'
        : lowerUserAgent.includes('crios/') ||
            lowerUserAgent.includes('chrome/')
          ? 'chrome'
          : lowerUserAgent.includes('safari/') ||
              lowerUserAgent.includes('applewebkit/')
            ? 'safari'
            : 'other';

  return {
    isMobile: isMobileDevice(),
    browserFamily,
    platformFamily,
  };
}

export function isSmartTvDevice() {
  if (typeof navigator === 'undefined') return false;

  const override = getSmartTvModeOverride();
  if (override === 'on') return true;
  if (override === 'off') return false;

  const nav = navigator as NavigatorWithUserAgentData;
  const userAgent = (nav.userAgent ?? '').toLowerCase();

  if (SMART_TV_UA_PATTERN.test(userAgent)) {
    return true;
  }

  const uaPlatform = (nav.userAgentData?.platform ?? '').toLowerCase();
  const navigatorPlatform = (nav.platform ?? '').toLowerCase();
  const hasTvPlatformHint = /tv|tizen|webos|roku|xbox|playstation/.test(
    `${uaPlatform} ${navigatorPlatform}`,
  );
  if (hasTvPlatformHint) {
    return true;
  }

  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const likelyLeanbackInput =
    maxTouchPoints === 0 &&
    (hasNoHoverPrimaryPointer() || hasCoarsePrimaryPointer());

  const viewportHint =
    typeof window !== 'undefined' &&
    Math.min(window.innerWidth, window.innerHeight) >= 540;

  const lowPowerHint = (nav.deviceMemory ?? 8) <= 4;
  return Boolean(
    likelyLeanbackInput && viewportHint && lowPowerHint && !isMobileDevice(),
  );
}

const IN_APP_BROWSER_PATTERN =
  /(instagram|fbav|fban|tiktok|musical_ly|twitter|micromessenger|line\/|slack|snapchat|gsa\/)/i;

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithUserAgentData;
  const userAgent = nav.userAgent ?? '';
  return IN_APP_BROWSER_PATTERN.test(userAgent);
}

export function openExternalBrowserIntent(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent ?? '';
  const isAndroid = /android/i.test(userAgent);

  if (isAndroid) {
    const intentUrl = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = intentUrl;
    return true;
  }

  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(window.location.href);
    }
  } catch {
    // ignore clipboard failure
  }
  return false;
}
