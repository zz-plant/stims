export function shouldUseSafeMilkdropWebGpuPath(
  location: Pick<Location, 'search'> | null | undefined = globalThis.location,
) {
  if (!location?.search) {
    return false;
  }

  const searchParams = new URLSearchParams(location.search);
  return searchParams.get('renderer')?.trim().toLowerCase() === 'webgpu';
}
