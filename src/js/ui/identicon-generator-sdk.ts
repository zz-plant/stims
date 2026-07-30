/**
 * Identicon Generator SDK
 * Unified developer suite for creating, profiling, and exporting parametric visual badges.
 */

import {
  type FilterShaderPreset,
  generateSvgFilterDef,
} from './svg-filter-shaders.ts';
import {
  generatePolygonPath,
  generateRoseCurvePath,
  generateTrochoidPath,
  pointsToSvgPathD,
  type SymmetryGroup,
} from './svg-geometry-engine.ts';

export interface IdenticonSdkOptions {
  seed: string;
  size?: number;
  symmetry?: SymmetryGroup;
  filterPreset?: FilterShaderPreset;
  audioPeak?: number;
  multiBand?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  mood?: string;
}

/**
 * Maps MilkDrop preset catalog entries or arbitrary strings into deterministic SDK options.
 */
export function presetToSeedOptions(
  presetId: string,
  mood?: string,
  _tags?: string[],
): IdenticonSdkOptions {
  let hash = 0;
  for (let i = 0; i < presetId.length; i++) {
    hash = (hash << 5) - hash + presetId.charCodeAt(i);
    hash |= 0;
  }
  const uHash = Math.abs(hash);

  const symmetries: SymmetryGroup[] = [
    'cyclic',
    'dihedral',
    'rose',
    'trochoid',
  ];
  const symmetry = symmetries[uHash % symmetries.length];

  const filters: FilterShaderPreset[] = [
    'none',
    'glass-emboss',
    'neon-aberration',
    'liquid-warp',
  ];
  const filterPreset = filters[(uHash >> 4) % filters.length];

  return {
    seed: presetId,
    symmetry,
    filterPreset,
    mood,
  };
}

/**
 * Creates a complete SVG element string with optional inline SVG filter shaders.
 */
export function createIdenticonSvgString(options: IdenticonSdkOptions): string {
  const size = options.size ?? 48;
  const center = { x: size / 2, y: size / 2 };
  const radius = Math.max(4, size / 2 - 6);

  let hash = 0;
  for (let i = 0; i < options.seed.length; i++) {
    hash = (hash << 5) - hash + options.seed.charCodeAt(i);
    hash |= 0;
  }
  const uHash = Math.abs(hash);
  const hue = (uHash >> 3) % 360;

  const symmetry = options.symmetry ?? 'dihedral';
  const filterPreset = options.filterPreset ?? 'none';
  const filterId = `identicon-filter-${uHash}`;
  const filterXml = generateSvgFilterDef({
    filterId,
    preset: filterPreset,
    audioPeak: options.audioPeak,
  });

  let pathD = '';
  if (symmetry === 'rose') {
    const k = 3 + (uHash % 5);
    pathD = pointsToSvgPathD(generateRoseCurvePath(center, radius, k));
  } else if (symmetry === 'trochoid') {
    pathD = pointsToSvgPathD(generateTrochoidPath(center, radius));
  } else {
    const sides = 3 + (uHash % 6);
    pathD = pointsToSvgPathD(generatePolygonPath(center, radius, sides));
  }

  const filterAttr =
    filterPreset !== 'none' ? `filter="url(#${filterId})"` : '';

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg" class="stims-sdk-identicon">
    <defs>
      ${filterXml}
    </defs>
    <path d="${pathD}" stroke="hsl(${hue}, 85%, 65%)" stroke-width="1.8" stroke-linejoin="round" fill="hsl(${hue}, 85%, 15%)" fill-opacity="0.4" ${filterAttr} />
  </svg>`;
}

/**
 * Asynchronously rasterizes an SVG identicon options object to a PNG Data URL.
 */
export async function exportToPngDataUrl(
  options: IdenticonSdkOptions,
  scale = 2,
): Promise<string> {
  const svgString = createIdenticonSvgString(options);
  const size = (options.size ?? 48) * scale;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgString], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get 2d canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}
