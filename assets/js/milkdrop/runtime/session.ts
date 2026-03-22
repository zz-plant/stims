import type {
  MilkdropBlendState,
  MilkdropCatalogEntry,
  MilkdropFrameState,
} from '../types';

export function cloneBlendState(
  frameState: MilkdropFrameState | null,
): MilkdropBlendState | null {
  if (!frameState) {
    return null;
  }
  return {
    mode: 'gpu',
    previousFrame: frameState,
    alpha: 1,
  };
}

export function estimateFrameBlendWorkload(
  frameState: MilkdropFrameState | null,
) {
  if (!frameState) {
    return 0;
  }

  const customWavePoints = frameState.customWaves.reduce(
    (total, wave) => total + Math.floor(wave.positions.length / 3),
    0,
  );
  const motionVectorSegments = frameState.motionVectors.length;

  return (
    Math.floor(frameState.mainWave.positions.length / 3) +
    customWavePoints +
    Math.floor(frameState.mesh.positions.length / 6) * 0.5 +
    motionVectorSegments * 2 +
    frameState.shapes.length * 10 +
    frameState.borders.length * 12 +
    frameState.trails.length * 8
  );
}

export function isEditablePreset(
  entry: MilkdropCatalogEntry | undefined | null,
) {
  return entry?.origin === 'imported' || entry?.origin === 'user';
}
