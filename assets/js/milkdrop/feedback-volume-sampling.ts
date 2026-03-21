export const AUX_TEXTURE_ATLAS_GRID_SIZE = 8;
export const AUX_TEXTURE_ATLAS_SLICE_COUNT =
  AUX_TEXTURE_ATLAS_GRID_SIZE * AUX_TEXTURE_ATLAS_GRID_SIZE;

export function wrapTex3DSlicePhase(sliceZ: number) {
  return ((sliceZ % 1) + 1) % 1;
}

export function getWrappedAtlasSliceSample(
  sliceZ: number,
  sliceCount = AUX_TEXTURE_ATLAS_SLICE_COUNT,
) {
  const wrappedSliceZ = wrapTex3DSlicePhase(sliceZ);
  const scaledSlice = wrappedSliceZ * sliceCount;
  const sliceIndexA = Math.floor(scaledSlice) % sliceCount;
  return {
    wrappedSliceZ,
    scaledSlice,
    sliceIndexA,
    sliceIndexB: (sliceIndexA + 1) % sliceCount,
    sliceBlend: scaledSlice - Math.floor(scaledSlice),
  };
}
