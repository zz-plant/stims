/**
 * A plain-language summary of a preset read from its source text: which
 * motion fields its equations touch, its base wave color and trail length,
 * which audio bands it reads, and how many custom waves and shapes it enables.
 *
 * It is a keyword scan, not an evaluation — `zoom` appearing in an equation
 * counts as dynamic zoom — so the summary says what the code mentions, not
 * what a frame will look like.
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
    // `.milk` files number their equation lines (`per_frame_1=`); the
    // editor's own drafts may not.
    const perFrame = /^per_frame(?:_\d+)?=(.*)$/u.exec(trimmed);
    const perPixel = /^per_pixel(?:_\d+)?=(.*)$/u.exec(trimmed);
    if (perFrame) {
      perFrameCode += ` ${perFrame[1]}`;
    } else if (perPixel) {
      perPixelCode += ` ${perPixel[1]}`;
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
        ? 'zooms in'
        : zoomVal < 0.98
          ? 'zooms out'
          : 'zoom changes over time',
    );
  }
  if (hasDynamicRot || Math.abs(rotVal) > 0.01) {
    motionParts.push(
      rotVal < 0 ? 'rotates counter-clockwise' : 'rotates clockwise',
    );
  }
  if (hasDynamicWarp) {
    motionParts.push('warps');
  }
  if (hasTranslation) {
    motionParts.push('pans');
  }
  const motionDesc =
    motionParts.length > 0
      ? motionParts.join(', ')
      : 'no zoom, rotation, warp, or panning';

  // Color analysis
  const hasDynamicColors =
    allEquations.includes('wave_r') ||
    allEquations.includes('wave_g') ||
    allEquations.includes('wave_b') ||
    allEquations.includes('q');

  let primaryHueHint = 'Mixed';
  if (waveR > 0.7 && waveG < 0.3 && waveB < 0.4) primaryHueHint = 'Red';
  else if (waveB > 0.7 && waveR < 0.3) primaryHueHint = 'Blue';
  else if (waveG > 0.7 && waveR < 0.4) primaryHueHint = 'Green';
  else if (waveR > 0.6 && waveB > 0.6 && waveG < 0.3)
    primaryHueHint = 'Magenta';

  const colorDesc = `${primaryHueHint} wave, ${
    decayVal > 0.98
      ? 'long trails'
      : decayVal < 0.93
        ? 'short trails'
        : 'medium trails'
  }${hasDynamicColors ? ', colors change over time' : ''}`;

  // Reactivity analysis
  const reactsToBass =
    allEquations.includes('bass') || allEquations.includes('bass_att');
  const reactsToTreble =
    allEquations.includes('treb') || allEquations.includes('treb_att');
  const reactsToMids =
    allEquations.includes('mid') || allEquations.includes('mid_att');

  const reactiveBands: string[] = [];
  if (reactsToBass) reactiveBands.push('bass');
  if (reactsToMids) reactiveBands.push('mids');
  if (reactsToTreble) reactiveBands.push('treble');

  const reactivityDesc =
    reactiveBands.length > 0
      ? `Reacts to ${reactiveBands.join(', ')}`
      : 'No bass, mid, or treble terms in the equations';

  const extras = [
    customShapeCount > 0 ? plural(customShapeCount, 'custom shape') : null,
    customWaveCount > 0 ? plural(customWaveCount, 'custom wave') : null,
  ].filter(Boolean);
  const summary = [
    `Motion: ${motionDesc}.`,
    `Audio: ${reactivityDesc.charAt(0).toLowerCase()}${reactivityDesc.slice(1)}.`,
    `Color: ${colorDesc.toLowerCase()}.`,
    extras.length > 0 ? `This preset also draws ${extras.join(' and ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Tags
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

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
