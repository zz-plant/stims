type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
  platform?: string;
  maxTouchPoints?: number;
  userAgent?: string;
};

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

  return false;
}
