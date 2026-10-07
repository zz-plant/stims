/**
 * One-click preset restyles and two-preset blending.
 *
 * Deterministic and client-side: each style overwrites a few base fields and
 * appends per-frame or per-pixel lines. No model is involved.
 */

import {
  readMilkdropField,
  upsertMilkdropFields,
} from 'milkdrop-toolchain/src/formatter.ts';

export type PresetMutationStyle =
  | 'cyberpunk'
  | 'hyperspace'
  | 'ambient-glow'
  | 'kaleidoscope'
  | 'bass-surge';

/** Button labels, in display order, for every surface that offers restyles. */
export const PRESET_MUTATION_STYLES: ReadonlyArray<{
  id: PresetMutationStyle;
  label: string;
}> = [
  { id: 'cyberpunk', label: 'Neon' },
  { id: 'hyperspace', label: 'Zoom tunnel' },
  { id: 'ambient-glow', label: 'Slow glow' },
  { id: 'kaleidoscope', label: 'Kaleidoscope' },
  { id: 'bass-surge', label: 'Bass pulse' },
];

/**
 * Appends equation lines to a preset's per-frame or per-pixel program.
 *
 * Program lines must be numbered (`per_frame_7=`) and continue after the
 * preset's own: the compiler reads a bare `per_frame=` as an unknown field
 * and drops it, which is how every restyle's equations used to vanish
 * while its plain settings still applied. A no-op when the first line is
 * already present, so applying a restyle twice adds its equations once.
 */
export function appendProgramLines(
  source: string,
  block: 'per_frame' | 'per_pixel',
  lines: readonly string[],
): string {
  const numbered = new RegExp(`^\\s*${block}_(\\d+)\\s*=`, 'gim');
  let last = 0;
  for (const match of source.matchAll(numbered)) {
    last = Math.max(last, Number(match[1]));
  }
  // Re-applying a restyle must not stack its equations: skip when its first
  // line is already there.
  const first = lines[0];
  if (first === undefined || source.includes(`=${first}`)) {
    return source;
  }
  const appended = lines
    .map((line, index) => `${block}_${last + index + 1}=${line}`)
    .join('\n');
  return `${source.replace(/\s*$/, '')}\n${appended}\n`;
}

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
        texture_wrap: 0,
      });

      // Inject neon / treble-reactive dynamics if not present
      updated = appendProgramLines(updated, 'per_frame', [
        'wave_r = 0.9 + 0.1 * sin(time * 1.5);',
        'wave_b = 0.7 + 0.3 * cos(treb * 2.0);',
        'zoom = zoom + 0.04 * treb_att;',
      ]);
      return updated;
    }

    case 'hyperspace': {
      let updated = upsertMilkdropFields(source, {
        zoom: 1.04,
        rot: 0.015,
        warp: 0.15,
        decay: 0.97,
        texture_wrap: 1,
      });

      updated = appendProgramLines(updated, 'per_pixel', [
        'zoom = zoom + 0.05 * sin(rad * 6.0 - time * 2.0);',
        'rot = rot + 0.02 * cos(ang * 4.0 + time);',
      ]);
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

      updated = appendProgramLines(updated, 'per_frame', [
        'wave_g = 0.7 + 0.3 * sin(time * 0.3);',
        'wave_b = 0.6 + 0.4 * cos(time * 0.4);',
        'rot = 0.005 * sin(time * 0.2);',
      ]);
      return updated;
    }

    case 'kaleidoscope': {
      let updated = upsertMilkdropFields(source, {
        warp: 0.25,
        rot: 0.02,
        zoom: 1.01,
        decay: 0.96,
        texture_wrap: 1,
      });

      updated = appendProgramLines(updated, 'per_pixel', [
        'dx = 0.02 * sin(ang * 6.0 + rad * 8.0);',
        'dy = 0.02 * cos(ang * 6.0 + rad * 8.0);',
      ]);
      return updated;
    }

    case 'bass-surge': {
      let updated = upsertMilkdropFields(source, {
        decay: 0.95,
        zoom: 1.02,
        brighten: 1,
      });

      updated = appendProgramLines(updated, 'per_frame', [
        'zoom = 1.0 + 0.08 * (bass_att - 1.0);',
        'decay = 0.94 + 0.05 * (bass - 1.0);',
      ]);
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
