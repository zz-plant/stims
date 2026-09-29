/**
 * MilkDrop 2 export — writes a compiled preset as the `.milk` file MilkDrop 2
 * itself saves, so an export opens the same in MilkDrop 2, projectM and
 * Butterchurn as it does here.
 *
 * The editor's formatted source is Stims' dialect: readable names
 * (`gammaadj`, `wave_mode`), `[warp_shader]` sections, no `[preset00]`
 * header. Stims reads it; MilkDrop 2 does not — it reads `fGammaAdj` and
 * `nWaveMode` under `[preset00]` and shaders as backtick-prefixed `warp_N=`
 * lines. Exporting the dialect handed other engines a file whose base values
 * were all ignored and whose shaders were missing.
 *
 * Field order and spelling follow a file MilkDrop 2 wrote (see the corpus'
 * `MILKDROP_PRESET_VERSION=201` presets). Every base value is written, as
 * MilkDrop 2 does, from the values Stims renders with — so an engine with
 * different defaults still draws what Stims draws. Keys MilkDrop 2 has no
 * name for (Stims-only fields that differ from their default, `title`,
 * `author`, fields Stims keeps but ignores) follow the MilkDrop 2 block;
 * other engines skip them and Stims reads them back.
 */

import { DEFAULT_MILKDROP_STATE } from './compiler/default-state.ts';
import {
  emitProgramLines,
  FALLBACK_TITLE,
  formatNumber,
  resolveFormattedTitle,
  resolveShaderText,
  serializeString,
} from './formatter.ts';
import { ensureShaderBody } from './shader-source.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from './types';

/** MilkDrop 2's `[preset00]` scalars, in its order: [its key, Stims' key]. */
const MILKDROP2_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['fRating', 'fRating'],
  ['fGammaAdj', 'gammaadj'],
  ['fDecay', 'decay'],
  ['fVideoEchoZoom', 'video_echo_zoom'],
  ['fVideoEchoAlpha', 'video_echo_alpha'],
  ['nVideoEchoOrientation', 'video_echo_orientation'],
  ['nWaveMode', 'wave_mode'],
  ['bAdditiveWaves', 'wave_additive'],
  ['bWaveDots', 'wave_usedots'],
  ['bWaveThick', 'wave_thick'],
  ['bModWaveAlphaByVolume', 'bmodwavealphabyvolume'],
  ['bMaximizeWaveColor', 'wave_brighten'],
  ['bTexWrap', 'texture_wrap'],
  ['bDarkenCenter', 'darken_center'],
  ['bRedBlueStereo', 'red_blue_stereo'],
  ['bBrighten', 'brighten'],
  ['bDarken', 'darken'],
  ['bSolarize', 'solarize'],
  ['bInvert', 'invert'],
  ['fWaveAlpha', 'wave_a'],
  ['fWaveScale', 'wave_scale'],
  ['fWaveSmoothing', 'wave_smoothing'],
  ['fWaveParam', 'wave_mystery'],
  ['fModWaveAlphaStart', 'modwavealphastart'],
  ['fModWaveAlphaEnd', 'modwavealphaend'],
  ['fWarpAnimSpeed', 'warpanimspeed'],
  ['fWarpScale', 'warp_scale'],
  ['fZoomExponent', 'zoomexp'],
  ['fShader', 'shader'],
  ['zoom', 'zoom'],
  ['rot', 'rot'],
  ['cx', 'cx'],
  ['cy', 'cy'],
  ['dx', 'dx'],
  ['dy', 'dy'],
  ['warp', 'warp'],
  ['sx', 'sx'],
  ['sy', 'sy'],
  ['wave_r', 'wave_r'],
  ['wave_g', 'wave_g'],
  ['wave_b', 'wave_b'],
  ['wave_x', 'wave_x'],
  ['wave_y', 'wave_y'],
  ['ob_size', 'ob_size'],
  ['ob_r', 'ob_r'],
  ['ob_g', 'ob_g'],
  ['ob_b', 'ob_b'],
  ['ob_a', 'ob_a'],
  ['ib_size', 'ib_size'],
  ['ib_r', 'ib_r'],
  ['ib_g', 'ib_g'],
  ['ib_b', 'ib_b'],
  ['ib_a', 'ib_a'],
  ['nMotionVectorsX', 'motion_vectors_x'],
  ['nMotionVectorsY', 'motion_vectors_y'],
  ['mv_dx', 'mv_dx'],
  ['mv_dy', 'mv_dy'],
  ['mv_l', 'mv_l'],
  ['mv_r', 'mv_r'],
  ['mv_g', 'mv_g'],
  ['mv_b', 'mv_b'],
  ['mv_a', 'mv_a'],
  ['b1n', 'blur1_min'],
  ['b2n', 'blur2_min'],
  ['b3n', 'blur3_min'],
  ['b1x', 'blur1_max'],
  ['b2x', 'blur2_max'],
  ['b3x', 'blur3_max'],
];

/** Stims keys the header or the MilkDrop 2 block already accounts for. */
export const MILKDROP2_STIMS_KEYS: ReadonlySet<string> = new Set([
  ...MILKDROP2_FIELDS.map(([, stimsKey]) => stimsKey),
  'milkdrop_preset_version',
  'psversion',
  'psversion_warp',
  'psversion_comp',
]);

const WAVE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['enabled', 'enabled'],
  ['samples', 'samples'],
  ['sep', 'sep'],
  ['bSpectrum', 'spectrum'],
  ['bUseDots', 'usedots'],
  ['bDrawThick', 'thick'],
  ['bAdditive', 'additive'],
  ['scaling', 'scaling'],
  ['smoothing', 'smoothing'],
  ['r', 'r'],
  ['g', 'g'],
  ['b', 'b'],
  ['a', 'a'],
];

const SHAPE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['enabled', 'enabled'],
  ['sides', 'sides'],
  ['additive', 'additive'],
  ['thickOutline', 'thickoutline'],
  ['textured', 'textured'],
  ['num_inst', 'num_inst'],
  ['x', 'x'],
  ['y', 'y'],
  ['rad', 'rad'],
  ['ang', 'ang'],
  ['tex_ang', 'tex_ang'],
  ['tex_zoom', 'tex_zoom'],
  ['r', 'r'],
  ['g', 'g'],
  ['b', 'b'],
  ['a', 'a'],
  ['r2', 'r2'],
  ['g2', 'g2'],
  ['b2', 'b2'],
  ['a2', 'a2'],
  ['border_r', 'border_r'],
  ['border_g', 'border_g'],
  ['border_b', 'border_b'],
  ['border_a', 'border_a'],
];

/** Declared fields in MilkDrop 2's order, then any others it has no slot for. */
function emitSlotFields(
  lines: string[],
  prefix: string,
  fields: Record<string, number>,
  order: ReadonlyArray<readonly [string, string]>,
) {
  const known = new Set(order.map(([, stimsKey]) => stimsKey));
  for (const [key, stimsKey] of order) {
    const value = fields[stimsKey];
    if (typeof value === 'number') {
      lines.push(`${prefix}${key}=${formatNumber(value)}`);
    }
  }
  Object.keys(fields)
    .filter((key) => !known.has(key))
    .sort()
    .forEach((key) => {
      lines.push(`${prefix}${key}=${formatNumber(fields[key] as number)}`);
    });
}

function emitWave(lines: string[], wave: MilkdropWaveDefinition) {
  const slot = wave.index - 1;
  emitSlotFields(lines, `wavecode_${slot}_`, wave.fields, WAVE_FIELDS);
  emitProgramLines(lines, `wave_${slot}_init`, wave.programs.init);
  emitProgramLines(lines, `wave_${slot}_per_frame`, wave.programs.perFrame);
  emitProgramLines(lines, `wave_${slot}_per_point`, wave.programs.perPoint);
}

function emitShape(lines: string[], shape: MilkdropShapeDefinition) {
  const slot = shape.index - 1;
  emitSlotFields(lines, `shapecode_${slot}_`, shape.fields, SHAPE_FIELDS);
  emitProgramLines(lines, `shape_${slot}_init`, shape.programs.init);
  emitProgramLines(lines, `shape_${slot}_per_frame`, shape.programs.perFrame);
}

function emitShaderLines(lines: string[], stage: string, text: string | null) {
  if (!text) {
    return;
  }
  ensureShaderBody(text)
    .split('\n')
    .forEach((line, index) => {
      lines.push(`${stage}_${index + 1}=\`${line}`);
    });
}

function shaderVersion(declared: number | undefined, hasShader: boolean) {
  if (!hasShader) {
    return 0;
  }
  return Math.max(2, Math.trunc(declared ?? 0));
}

export function exportMilkdrop2Preset(
  compiled: MilkdropCompiledPreset,
): string {
  const { ir } = compiled;
  const values = ir.numericFields;
  const warp = resolveShaderText(ir, 'warp');
  const comp = resolveShaderText(ir, 'comp');
  const warpVersion = shaderVersion(values.psversion_warp, Boolean(warp));
  const compVersion = shaderVersion(values.psversion_comp, Boolean(comp));

  const lines = [
    'MILKDROP_PRESET_VERSION=201',
    `PSVERSION=${Math.max(warpVersion, compVersion)}`,
    `PSVERSION_WARP=${warpVersion}`,
    `PSVERSION_COMP=${compVersion}`,
    '[preset00]',
  ];

  for (const [key, stimsKey] of MILKDROP2_FIELDS) {
    lines.push(
      `${key}=${formatNumber(values[stimsKey] ?? DEFAULT_MILKDROP_STATE[stimsKey] ?? 0)}`,
    );
  }

  // Stims-only fields, only when they change something: at their default
  // they are noise to every other engine.
  Object.keys(values)
    .filter(
      (key) =>
        !MILKDROP2_STIMS_KEYS.has(key) &&
        !key.startsWith('shape_') &&
        !key.startsWith('custom_wave_') &&
        values[key] !== DEFAULT_MILKDROP_STATE[key],
    )
    .sort()
    .forEach((key) => {
      lines.push(`${key}=${formatNumber(values[key] as number)}`);
    });

  // MilkDrop names a preset by its file; `title=` only carries a real title
  // back into Stims, so the placeholder a titleless preset compiles with is
  // not written.
  const title = resolveFormattedTitle(compiled);
  if (title !== FALLBACK_TITLE) {
    lines.push(`title=${serializeString(title)}`);
  }
  if (ir.author) {
    lines.push(`author=${serializeString(ir.author)}`);
  }
  if (ir.description) {
    lines.push(`description=${serializeString(ir.description)}`);
  }
  for (const { key, rawValue } of ir.preservedFields ?? []) {
    lines.push(`${key}=${rawValue}`);
  }

  ir.customWaves.forEach((wave) => {
    emitWave(lines, wave);
  });
  ir.customShapes.forEach((shape) => {
    emitShape(lines, shape);
  });

  emitProgramLines(lines, 'per_frame_init_', ir.programs.init);
  emitProgramLines(lines, 'per_frame_', ir.programs.perFrame);
  emitProgramLines(lines, 'per_pixel_', ir.programs.perPixel);
  emitShaderLines(lines, 'warp', warp);
  emitShaderLines(lines, 'comp', comp);

  // MilkDrop 2 writes CRLF, but reads either; LF keeps diffs readable.
  return `${lines.join('\n')}\n`;
}
