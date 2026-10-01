/**
 * Tune controls for one custom wave or shape.
 *
 * Up to eight of them draw much of a preset's picture, and their settings
 * were reachable only as `shapecode_1_rad=0.2` lines: MilkDrop 2 gave each
 * its own settings screen. The Tune pane shows the one picked in its element
 * picker, with the same faders, swatches and switches as the rest of the
 * pane, so every move is still a line in the draft.
 *
 * Keys use MilkDrop 2's spellings (`wavecode_0_bDrawThick`); the formatter
 * finds a field under whichever spelling the preset already uses. Defaults
 * are the compiler's own, so a field the file leaves out shows the value the
 * preset actually runs with.
 */
import { DEFAULT_MILKDROP_STATE } from './compiler';
import type {
  ColorGroupConfig,
  ScalarControlConfig,
  ToggleControlConfig,
} from './preset-controls.ts';

export type SlotKind = 'wave' | 'shape';

/** A custom wave or shape as the file names it: `wave_0`, `shape_3`. */
export type SlotName = `${SlotKind}_${number}`;

export type SlotControls = {
  toggles: ToggleControlConfig[];
  scalars: ScalarControlConfig[];
  colors: ColorGroupConfig[];
};

export function parseSlotName(
  name: string,
): { kind: SlotKind; slot: number } | null {
  const match = /^(wave|shape)_(\d+)$/u.exec(name);
  return match ? { kind: match[1] as SlotKind, slot: Number(match[2]) } : null;
}

export function slotControls(kind: SlotKind, slot: number): SlotControls {
  const prefix = `${kind === 'wave' ? 'wavecode' : 'shapecode'}_${slot}_`;
  // The compiler keeps slot defaults under its own names, counting from 1.
  const defaults = DEFAULT_MILKDROP_STATE as Record<string, number | undefined>;
  const base = (field: string) =>
    defaults[
      `${kind === 'wave' ? 'custom_wave' : 'shape'}_${slot + 1}_${field}`
    ] ?? 0;
  const toggle = (
    label: string,
    fileKey: string,
    field: string,
    hint: string,
  ): ToggleControlConfig => ({
    label,
    key: `${prefix}${fileKey}`,
    section: 'element',
    defaultValue: base(field) >= 0.5 ? 1 : 0,
    hint,
  });
  const scalar = (
    config: Omit<ScalarControlConfig, 'key' | 'section' | 'defaultValue'> & {
      fileKey: string;
      field: string;
    },
  ): ScalarControlConfig => {
    const { fileKey, field, ...rest } = config;
    return {
      ...rest,
      key: `${prefix}${fileKey}`,
      section: 'element',
      defaultValue: base(field),
    };
  };
  const color = (
    label: string,
    channels: [string, string, string],
    alpha: string,
    hint: string,
  ): ColorGroupConfig => ({
    label,
    section: 'element',
    rgb: channels.map((channel) => `${prefix}${channel}`) as [
      string,
      string,
      string,
    ],
    alpha: { key: `${prefix}${alpha}`, defaultValue: base(alpha) },
    defaultRgb: channels.map(base) as [number, number, number],
    hint,
  });

  const enabled = toggle(
    'Draw',
    'enabled',
    'enabled',
    kind === 'wave'
      ? 'Whether this wave is drawn. Its code runs either way.'
      : 'Whether this shape is drawn. Its code runs either way.',
  );

  if (kind === 'wave') {
    return {
      toggles: [
        enabled,
        toggle(
          'Spectrum',
          'bSpectrum',
          'spectrum',
          'Draw the frequency spectrum instead of the waveform.',
        ),
        toggle('Dots', 'bUseDots', 'usedots', 'Draw points, not a line.'),
        toggle('Thick', 'bDrawThick', 'thick', 'Draw twice as thick.'),
        toggle(
          'Additive',
          'bAdditive',
          'additive',
          'Add to what is underneath instead of covering it.',
        ),
      ],
      colors: [
        color(
          'Colour',
          ['r', 'g', 'b'],
          'a',
          'The wave’s colour; its code can set one per point.',
        ),
      ],
      scalars: [
        scalar({
          label: 'Samples',
          fileKey: 'samples',
          field: 'samples',
          min: 2,
          max: 512,
          step: 1,
          scale: 'linear',
          hint: 'How many points the wave is drawn with.',
        }),
        scalar({
          label: 'Scaling',
          fileKey: 'scaling',
          field: 'scaling',
          min: 0.1,
          max: 10,
          step: 0.01,
          scale: 'ratio',
          neutral: 1,
          hint: 'How far the audio pushes the points.',
        }),
        scalar({
          label: 'Smoothing',
          fileKey: 'smoothing',
          field: 'smoothing',
          min: 0,
          max: 1,
          step: 0.01,
          scale: 'linear',
          hint: 'How much each point follows its neighbours.',
        }),
      ],
    };
  }

  return {
    toggles: [
      enabled,
      toggle(
        'Additive',
        'additive',
        'additive',
        'Add to what is underneath instead of covering it.',
      ),
      toggle(
        'Thick outline',
        'thickOutline',
        'thickoutline',
        'Draw the border twice as thick.',
      ),
      toggle(
        'Textured',
        'textured',
        'textured',
        'Fill with the previous frame instead of a colour.',
      ),
    ],
    colors: [
      color('Centre', ['r', 'g', 'b'], 'a', 'The fill colour at the centre.'),
      color(
        'Edge',
        ['r2', 'g2', 'b2'],
        'a2',
        'The fill colour at the rim; the fill blends from the centre to it.',
      ),
      color(
        'Border',
        ['border_r', 'border_g', 'border_b'],
        'border_a',
        'The outline’s colour.',
      ),
    ],
    scalars: [
      scalar({
        label: 'Sides',
        fileKey: 'sides',
        field: 'sides',
        min: 3,
        max: 100,
        step: 1,
        scale: 'linear',
        hint: 'Corners; past about 30 it reads as a circle.',
      }),
      scalar({
        label: 'Radius',
        fileKey: 'rad',
        field: 'rad',
        min: 0,
        max: 1.5,
        step: 0.001,
        scale: 'linear',
        hint: 'Size, as a fraction of the screen.',
      }),
      scalar({
        label: 'X',
        fileKey: 'x',
        field: 'x',
        min: 0,
        max: 1,
        step: 0.001,
        scale: 'linear',
        hint: 'Horizontal position, 0 left to 1 right.',
      }),
      scalar({
        label: 'Y',
        fileKey: 'y',
        field: 'y',
        min: 0,
        max: 1,
        step: 0.001,
        scale: 'linear',
        hint: 'Vertical position, 0 bottom to 1 top.',
      }),
      scalar({
        label: 'Angle',
        fileKey: 'ang',
        field: 'ang',
        min: 0,
        max: 6.2832,
        step: 0.001,
        scale: 'linear',
        unit: ' rad',
        hint: 'Rotation in radians; 6.28 is a full turn.',
      }),
    ],
  };
}
