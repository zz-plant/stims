export function shouldPreferWebGLForKnownCompatibilityGaps() {
  if (typeof window === 'undefined') {
    return true;
  }

  const requestedRenderer = new URLSearchParams(window.location.search)
    .get('renderer')
    ?.trim()
    .toLowerCase();

  if (requestedRenderer === 'webgpu') {
    return false;
  }

  return true;
}
