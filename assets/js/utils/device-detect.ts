type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
  };
  platform?: string;
  maxTouchPoints?: number;
  userAgent?: string;
  deviceMemory?: number;
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
  if (typeof window === 'undefined') return;
  try {
    if (!override || override === 'auto') {
      window.localStorage.removeItem(SMART_TV_OVERRIDE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SMART_TV_OVERRIDE_STORAGE_KEY, override);
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function getSmartTvModeOverride(): SmartTvOverride | null {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const queryOverride =
      parseSmartTvOverride(params.get('tv')) ??
      parseSmartTvOverride(params.get('tvMode'));
    if (queryOverride) {
      persistSmartTvOverride(queryOverride);
      return queryOverride;
    }
  }

  try {
    const storedOverride =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(SMART_TV_OVERRIDE_STORAGE_KEY)
        : null;
    return parseSmartTvOverride(storedOverride);
  } catch (_error) {
    return null;
  }
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
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(hover: hover)').matches
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
