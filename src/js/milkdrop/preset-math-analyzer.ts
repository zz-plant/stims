/**
 * Preset Math Analyzer
 *
 * Performs structural and semantic analysis over MilkDrop EEL2 equations,
 * breaking down cryptic mathematical code into structured visual insights:
 * motion vectors, color dynamics, audio-reactive bindings, and geometric complexity.
 */

import { readMilkdropField } from './formatter.ts';

export type PresetMathAnalysis = {
  summary: string;
  motion: {
    hasZoom: boolean;
    hasRotation: boolean;
    hasWarp: boolean;
    hasTranslation: boolean;
    description: string;
  };
  colors: {
    decayRate: number;
    hasDynamicColors: boolean;
    primaryHueHint: string;
    description: string;
  };
  audioReactivity: {
    reactsToBass: boolean;
    reactsToTreble: boolean;
    reactsToMids: boolean;
    description: string;
  };
  complexity: {
    perFrameLines: number;
    perPixelLines: number;
    customWaveCount: number;
    customShapeCount: number;
    usesMegabuf: boolean;
  };
  tags: string[];
};

export function analyzePresetMath(source: string): PresetMathAnalysis {
  const lines = source.split(/\r?\n/u);

  let perFrameCode = '';
  let perPixelCode = '';
  let customWaveCount = 0;
  let customShapeCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('per_frame=')) {
      perFrameCode += ` ${trimmed.slice('per_frame='.length)}`;
    } else if (trimmed.startsWith('per_pixel=')) {
      perPixelCode += ` ${trimmed.slice('per_pixel='.length)}`;
    } else if (/^wavecode_\d+_enabled=1/u.test(trimmed)) {
      customWaveCount += 1;
    } else if (/^shapecode_\d+_enabled=1/u.test(trimmed)) {
      customShapeCount += 1;
    }
  }

  const allEquations = `${perFrameCode} ${perPixelCode}`.toLowerCase();

  // Read literal values
  const zoomVal = Number(readMilkdropField(source, 'zoom') ?? '1.0');
  const rotVal = Number(readMilkdropField(source, 'rot') ?? '0.0');
  const warpVal = Number(readMilkdropField(source, 'warp') ?? '0.0');
  const decayVal = Number(readMilkdropField(source, 'decay') ?? '0.98');
  const waveR = Number(readMilkdropField(source, 'wave_r') ?? '0.8');
  const waveG = Number(readMilkdropField(source, 'wave_g') ?? '0.5');
  const waveB = Number(readMilkdropField(source, 'wave_b') ?? '0.3');

  // Motion analysis
  const hasDynamicZoom = allEquations.includes('zoom');
  const hasDynamicRot = allEquations.includes('rot');
  const hasDynamicWarp = allEquations.includes('warp') || warpVal > 0.05;
  const hasTranslation =
    allEquations.includes('dx') ||
    allEquations.includes('dy') ||
    allEquations.includes('cx') ||
    allEquations.includes('cy');

  const motionParts: string[] = [];
  if (hasDynamicZoom || zoomVal !== 1.0) {
    motionParts.push(
      zoomVal > 1.02
        ? 'forward zoom vortex'
        : zoomVal < 0.98
          ? 'tunnel zoom-out'
          : 'pulsing zoom',
    );
  }
  if (hasDynamicRot || Math.abs(rotVal) > 0.01) {
    motionParts.push(
      rotVal < 0 ? 'counter-clockwise spiral' : 'clockwise rotation',
    );
  }
  if (hasDynamicWarp) {
    motionParts.push('non-linear spatial warp');
  }
  if (hasTranslation) {
    motionParts.push('coordinate panning');
  }
  const motionDesc =
    motionParts.length > 0
      ? motionParts.join(', ')
      : 'static geometric framing with neutral camera';

  // Color analysis
  const hasDynamicColors =
    allEquations.includes('wave_r') ||
    allEquations.includes('wave_g') ||
    allEquations.includes('wave_b') ||
    allEquations.includes('q');

  let primaryHueHint = 'Balanced spectrum';
  if (waveR > 0.7 && waveG < 0.3 && waveB < 0.4)
    primaryHueHint = 'Warm crimson / amber';
  else if (waveB > 0.7 && waveR < 0.3) primaryHueHint = 'Deep oceanic / cyan';
  else if (waveG > 0.7 && waveR < 0.4)
    primaryHueHint = 'Emerald bioluminescence';
  else if (waveR > 0.6 && waveB > 0.6 && waveG < 0.3)
    primaryHueHint = 'Neon synthwave magenta';

  const colorDesc = `${primaryHueHint} with ${
    decayVal > 0.98
      ? 'long atmospheric trails'
      : decayVal < 0.93
        ? 'sharp crisp transients'
        : 'moderate feedback decay'
  }${hasDynamicColors ? ' and dynamic color oscillators' : ''}`;

  // Reactivity analysis
  const reactsToBass =
    allEquations.includes('bass') || allEquations.includes('bass_att');
  const reactsToTreble =
    allEquations.includes('treb') || allEquations.includes('treb_att');
  const reactsToMids =
    allEquations.includes('mid') || allEquations.includes('mid_att');

  const reactiveBands: string[] = [];
  if (reactsToBass) reactiveBands.push('punchy bass kicks');
  if (reactsToTreble) reactiveBands.push('high-frequency treble shimmer');
  if (reactsToMids) reactiveBands.push('harmonic mid-tones');

  const reactivityDesc =
    reactiveBands.length > 0
      ? `Responds dynamically to ${reactiveBands.join(' and ')}`
      : 'Driven primarily by steady-state procedural oscillators';

  // Overall Narrative Summary
  const summary = `This preset generates ${
    customShapeCount > 0
      ? `${customShapeCount} layered custom shape(s) and `
      : ''
  }${
    customWaveCount > 0 ? `${customWaveCount} procedural waveform(s) with ` : ''
  }${motionDesc}. ${reactivityDesc}, painted in ${colorDesc.toLowerCase()}.`;

  // Semantic Tag extraction
  const tags: string[] = [];
  if (hasDynamicRot) tags.push('vortex', 'spiral');
  if (hasDynamicWarp) tags.push('warped', 'fluid');
  if (reactsToBass) tags.push('bass-reactive', 'pulsing');
  if (customShapeCount > 0) tags.push('geometric', 'shapes');
  if (customWaveCount > 0) tags.push('oscilloscope', 'waveform');
  if (decayVal > 0.98) tags.push('trails', 'ambient');

  return {
    summary,
    motion: {
      hasZoom: hasDynamicZoom || zoomVal !== 1.0,
      hasRotation: hasDynamicRot || Math.abs(rotVal) > 0.01,
      hasWarp: hasDynamicWarp,
      hasTranslation,
      description: motionDesc,
    },
    colors: {
      decayRate: decayVal,
      hasDynamicColors,
      primaryHueHint,
      description: colorDesc,
    },
    audioReactivity: {
      reactsToBass,
      reactsToTreble,
      reactsToMids,
      description: reactivityDesc,
    },
    complexity: {
      perFrameLines: perFrameCode ? perFrameCode.split(';').length - 1 : 0,
      perPixelLines: perPixelCode ? perPixelCode.split(';').length - 1 : 0,
      customWaveCount,
      customShapeCount,
      usesMegabuf:
        allEquations.includes('megabuf') || allEquations.includes('gmegabuf'),
    },
    tags,
  };
}
