import type {
  MilkdropBlendState,
  MilkdropCatalogEntry,
  MilkdropColor,
  MilkdropFrameState,
  MilkdropMotionVectorVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropWaveVisual,
} from '../types';

function cloneColor(color: MilkdropColor): MilkdropColor {
  return { ...color };
}

function cloneWaveVisual(wave: MilkdropWaveVisual): MilkdropWaveVisual {
  return {
    ...wave,
    positions: wave.positions.slice(),
    color: cloneColor(wave.color),
  };
}

function cloneProceduralCustomWaveVisual(
  wave: MilkdropProceduralCustomWaveVisual,
): MilkdropProceduralCustomWaveVisual {
  return {
    ...wave,
    samples: wave.samples.slice(),
    sampleValues2: wave.sampleValues2?.slice(),
    signals: wave.signals ? { ...wave.signals } : wave.signals,
    color: cloneColor(wave.color),
  };
}

function cloneMotionVectorVisual(
  vector: MilkdropMotionVectorVisual,
): MilkdropMotionVectorVisual {
  return {
    ...vector,
    positions: vector.positions.slice(),
    color: cloneColor(vector.color),
  };
}

export function cloneBlendState(
  frameState: MilkdropFrameState | null,
): MilkdropBlendState | null {
  if (!frameState) {
    return null;
  }
  return {
    mode: 'gpu',
    previousFrame: {
      ...frameState,
      customWaves: frameState.customWaves.map(cloneWaveVisual),
      motionVectors: frameState.motionVectors.map(cloneMotionVectorVisual),
      gpuGeometry: {
        ...frameState.gpuGeometry,
        customWaves: frameState.gpuGeometry.customWaves.map(
          cloneProceduralCustomWaveVisual,
        ),
      },
    },
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
