/** Inert data written by the edge before the workspace mounts. */
export function readSharedVideoArrival(): {
  presetId: string;
  source: string;
} | null {
  if (
    typeof document === 'undefined' ||
    typeof location === 'undefined' ||
    !/^\/s\/[a-f0-9]{64}$/.test(location.pathname)
  )
    return null;
  const text = document.getElementById('stims-video-share')?.textContent;
  if (!text || text.length > 800_000) return null;
  try {
    const value = JSON.parse(text);
    return typeof value?.presetId === 'string' &&
      typeof value?.source === 'string'
      ? { presetId: value.presetId, source: value.source }
      : null;
  } catch {
    return null;
  }
}
