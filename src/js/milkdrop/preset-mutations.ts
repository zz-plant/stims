/**
 * Preset Mutations & Style Transfer
 *
 * Provides intelligent, deterministic client-side preset transformations,
 * applying high-order mathematical style transfers and parametric blending
 * over MilkDrop `.milk` code blocks with zero network overhead.
 */

import { readMilkdropField, upsertMilkdropFields } from './formatter.ts';

export type PresetMutationStyle =
  | 'cyberpunk'
  | 'hyperspace'
  | 'ambient-glow'
  | 'kaleidoscope'
  | 'bass-surge';

export function mutatePresetStyle(
  source: string,
  style: PresetMutationStyle,
): string {
  switch (style) {
    case 'cyberpunk': {
      let updated = upsertMilkdropFields(source, {
        wave_r: 0.95,
        wave_g: 0.08,
        wave_b: 0.85,
        decay: 0.94,
        brighten: 1,
        darken: 0,
        solarize: 0,
        wrap: 0,
      });

      // Inject neon / treble-reactive dynamics if not present
      if (!updated.includes('wave_b = 0.8') && !updated.includes('treb_att')) {
        updated += `\nper_frame=wave_r = 0.9 + 0.1 * sin(time * 1.5);\nper_frame=wave_b = 0.7 + 0.3 * cos(treb * 2.0);\nper_frame=zoom = zoom + 0.04 * treb_att;\n`;
      }
      return updated;
    }

    case 'hyperspace': {
      let updated = upsertMilkdropFields(source, {
        zoom: 1.04,
        rot: 0.015,
        warp: 0.15,
        decay: 0.97,
        wrap: 1,
      });

      if (!updated.includes('rad * 8.0')) {
        updated += `\nper_pixel=zoom = zoom + 0.05 * sin(rad * 6.0 - time * 2.0);\nper_pixel=rot = rot + 0.02 * cos(ang * 4.0 + time);\n`;
      }
      return updated;
    }

    case 'ambient-glow': {
      let updated = upsertMilkdropFields(source, {
        wave_r: 0.2,
        wave_g: 0.85,
        wave_b: 0.65,
        decay: 0.992,
        warp: 0.02,
        zoom: 1.005,
      });

      if (!updated.includes('sin(time * 0.3)')) {
        updated += `\nper_frame=wave_g = 0.7 + 0.3 * sin(time * 0.3);\nper_frame=wave_b = 0.6 + 0.4 * cos(time * 0.4);\nper_frame=rot = 0.005 * sin(time * 0.2);\n`;
      }
      return updated;
    }

    case 'kaleidoscope': {
      let updated = upsertMilkdropFields(source, {
        warp: 0.25,
        rot: 0.02,
        zoom: 1.01,
        decay: 0.96,
        wrap: 1,
      });

      if (!updated.includes('ang * 6.0')) {
        updated += `\nper_pixel=dx = 0.02 * sin(ang * 6.0 + rad * 8.0);\nper_pixel=dy = 0.02 * cos(ang * 6.0 + rad * 8.0);\n`;
      }
      return updated;
    }

    case 'bass-surge': {
      let updated = upsertMilkdropFields(source, {
        decay: 0.95,
        zoom: 1.02,
        brighten: 1,
      });

      if (!updated.includes('bass_att * 0.08')) {
        updated += `\nper_frame=zoom = 1.0 + 0.08 * (bass_att - 1.0);\nper_frame=decay = 0.94 + 0.05 * (bass - 1.0);\n`;
      }
      return updated;
    }
  }
}

/**
 * Procedural Preset Blender: blends scalar parameters and combines equations
 * from two presets to create a novel hybrid preset.
 */
export function blendPresetSources(
  sourceA: string,
  sourceB: string,
  mix = 0.5,
): string {
  const t = Math.max(0, Math.min(1, mix));

  const num = (src: string, key: string, fallback: number) => {
    const val = readMilkdropField(src, key);
    return val !== null && !Number.isNaN(Number(val)) ? Number(val) : fallback;
  };

  const blendedFields: Record<string, number> = {
    zoom: num(sourceA, 'zoom', 1.0) * (1 - t) + num(sourceB, 'zoom', 1.0) * t,
    rot: num(sourceA, 'rot', 0.0) * (1 - t) + num(sourceB, 'rot', 0.0) * t,
    warp: num(sourceA, 'warp', 0.0) * (1 - t) + num(sourceB, 'warp', 0.0) * t,
    decay:
      num(sourceA, 'decay', 0.98) * (1 - t) + num(sourceB, 'decay', 0.98) * t,
    wave_r:
      num(sourceA, 'wave_r', 0.8) * (1 - t) + num(sourceB, 'wave_r', 0.8) * t,
    wave_g:
      num(sourceA, 'wave_g', 0.5) * (1 - t) + num(sourceB, 'wave_g', 0.5) * t,
    wave_b:
      num(sourceA, 'wave_b', 0.3) * (1 - t) + num(sourceB, 'wave_b', 0.3) * t,
    cx: num(sourceA, 'cx', 0.5) * (1 - t) + num(sourceB, 'cx', 0.5) * t,
    cy: num(sourceA, 'cy', 0.5) * (1 - t) + num(sourceB, 'cy', 0.5) * t,
    dx: num(sourceA, 'dx', 0.0) * (1 - t) + num(sourceB, 'dx', 0.0) * t,
    dy: num(sourceA, 'dy', 0.0) * (1 - t) + num(sourceB, 'dy', 0.0) * t,
  };

  const base = t < 0.5 ? sourceA : sourceB;
  return upsertMilkdropFields(base, blendedFields);
}
