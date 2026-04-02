const WEBGPU_COMPATIBILITY_OVERRIDE_KEY = 'stims:webgpu-compat-override';

function getSessionStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

function getRequestedRenderer() {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    new URLSearchParams(window.location.search)
      .get('renderer')
      ?.trim()
      .toLowerCase() ?? null
  );
}

export function setWebGPUCompatibilityGapOverride(enabled: boolean) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  if (enabled) {
    storage.setItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY, 'true');
    return;
  }

  storage.removeItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY);
}

export function clearWebGPUCompatibilityGapOverride() {
  setWebGPUCompatibilityGapOverride(false);
}

export function hasWebGPUCompatibilityGapOverride() {
  return (
    getSessionStorage()?.getItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY) === 'true'
  );
}

export function shouldPreferWebGLForKnownCompatibilityGaps() {
  const requestedRenderer = getRequestedRenderer();

  if (requestedRenderer === 'webgpu' || hasWebGPUCompatibilityGapOverride()) {
    return false;
  }

  return true;
}
