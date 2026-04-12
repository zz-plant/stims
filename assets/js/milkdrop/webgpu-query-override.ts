export function shouldUseSafeMilkdropWebGpuPath(
  location: Pick<Location, 'search'> | null | undefined = globalThis.location,
) {
  if (!location?.search) {
    return false;
  }

  const searchParams = new URLSearchParams(location.search);
  const renderer = searchParams.get('renderer')?.trim().toLowerCase();
  const corpus = searchParams.get('corpus')?.trim().toLowerCase();
  return renderer === 'webgpu' && corpus !== 'certification';
}
