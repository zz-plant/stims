import type * as THREE from 'three';

type MaterialWithColor = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
};

export type AudioColorParams = {
  baseHue: number;
  hueRange?: number;
  baseSaturation?: number;
  saturationRange?: number;
  baseLuminance?: number;
  luminanceRange?: number;
  emissive?: {
    baseHue?: number;
    hueRange?: number;
    baseSaturation?: number;
    saturationRange?: number;
    baseLuminance?: number;
    luminanceRange?: number;
  };
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function applyHsl(
  material: MaterialWithColor,
  normalizedValue: number,
  params: AudioColorParams,
) {
  const { color } = material;
  if (!color) return;

  const hue = (params.baseHue + normalizedValue * (params.hueRange ?? 0)) % 1;
  const saturation = clamp01(
    (params.baseSaturation ?? 0) +
      normalizedValue * (params.saturationRange ?? 0),
  );
  const luminance = clamp01(
    (params.baseLuminance ?? 0) +
      normalizedValue * (params.luminanceRange ?? 0),
  );

  color.setHSL(hue, saturation, luminance);
}

function applyEmissive(
  material: MaterialWithColor,
  normalizedValue: number,
  params: AudioColorParams['emissive'],
) {
  if (!params || !material.emissive) return;

  const hue =
    ((params.baseHue ?? 0) + normalizedValue * (params.hueRange ?? 0)) % 1;
  const saturation = clamp01(
    (params.baseSaturation ?? 0) +
      normalizedValue * (params.saturationRange ?? 0),
  );
  const luminance = clamp01(
    (params.baseLuminance ?? 0) +
      normalizedValue * (params.luminanceRange ?? 0),
  );

  material.emissive.setHSL(hue, saturation, luminance);
}

export function applyAudioColor(
  material: THREE.Material,
  normalizedValue: number,
  params: AudioColorParams,
) {
  const clampedValue = clamp01(normalizedValue);
  const materialWithColor = material as MaterialWithColor;

  applyHsl(materialWithColor, clampedValue, params);
  applyEmissive(materialWithColor, clampedValue, params.emissive);
}
