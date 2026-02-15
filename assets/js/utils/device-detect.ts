type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
  };
  platform?: string;
  maxTouchPoints?: number;
  userAgent?: string;
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

  const nav = navigator as NavigatorWithUserAgentData;
  const userAgent = (nav.userAgent ?? '').toLowerCase();

  return /(smart-tv|smarttv|hbbtv|appletv|googletv|android tv|aftb|aftt|aftm|tizen|web0s|webos|viera|netcast|roku|bravia|xbox|playstation)/i.test(
    userAgent,
  );
}
