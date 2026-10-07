/**
 * Every MilkDrop preset field Stims knows, in one table: the name Stims uses
 * internally, the key MilkDrop 2 writes in `[preset00]`, the other spellings
 * presets use for it, and how the editor writes it.
 *
 * These used to be kept separately — the compiler's alias map, the
 * formatter's canonical keys, the MilkDrop 2 exporter's field list, the
 * portability check's sets — and every new field or spelling had to be added
 * to each by hand. They had drifted (the formatter knew six canonical
 * spellings out of sixty). Everything that needs a field name now derives it
 * from here.
 *
 * Rows are in the order MilkDrop 2 writes its `[preset00]` block, then the
 * fields it has no key for. Pure data with no imports: the compiler worker
 * loads it.
 */

export type MilkdropFieldSpec = {
  /** The name the compiler and runtime use (`gammaadj`). */
  key: string;
  /** The `[preset00]` key MilkDrop 2 reads and writes, when it has one. */
  milkdrop2?: string;
  /** Other spellings presets use, normalised (lower case, `_` for others). */
  aliases?: readonly string[];
  /** How the editor's Format writes it, when not `key` (`fDecay`). */
  editor?: string;
};

export const MILKDROP_FIELDS: readonly MilkdropFieldSpec[] = [
  { key: 'fRating', milkdrop2: 'fRating' },
  { key: 'gammaadj', milkdrop2: 'fGammaAdj' },
  { key: 'decay', milkdrop2: 'fDecay', editor: 'fDecay' },
  {
    key: 'video_echo_zoom',
    milkdrop2: 'fVideoEchoZoom',
    aliases: ['echo_zoom'],
  },
  {
    key: 'video_echo_alpha',
    milkdrop2: 'fVideoEchoAlpha',
    aliases: ['echo_alpha'],
  },
  {
    key: 'video_echo_orientation',
    milkdrop2: 'nVideoEchoOrientation',
    aliases: ['echo_orient'],
  },
  { key: 'wave_mode', milkdrop2: 'nWaveMode' },
  {
    key: 'wave_additive',
    milkdrop2: 'bAdditiveWaves',
    aliases: ['additivewaves', 'waveadditive'],
  },
  {
    key: 'wave_usedots',
    milkdrop2: 'bWaveDots',
    aliases: ['wavedots', 'waveusedots'],
  },
  {
    key: 'wave_thick',
    milkdrop2: 'bWaveThick',
    aliases: ['fwavethick', 'wavethick'],
  },
  {
    key: 'bmodwavealphabyvolume',
    milkdrop2: 'bModWaveAlphaByVolume',
    // Listed as its own alias: the compiler checks membership in the alias
    // map, and this key has always been in it.
    aliases: ['modwavealphabyvolume', 'bmodwavealphabyvolume'],
  },
  { key: 'wave_brighten', milkdrop2: 'bMaximizeWaveColor' },
  { key: 'texture_wrap', milkdrop2: 'bTexWrap' },
  {
    key: 'darken_center',
    milkdrop2: 'bDarkenCenter',
    editor: 'bDarkenCenter',
  },
  {
    key: 'red_blue_stereo',
    milkdrop2: 'bRedBlueStereo',
    aliases: ['redbluestereo'],
  },
  {
    key: 'brighten',
    milkdrop2: 'bBrighten',
    aliases: ['fbrighten'],
    editor: 'bBrighten',
  },
  {
    key: 'darken',
    milkdrop2: 'bDarken',
    aliases: ['fdarken'],
    editor: 'bDarken',
  },
  {
    key: 'solarize',
    milkdrop2: 'bSolarize',
    aliases: ['fsolarize'],
    editor: 'bSolarize',
  },
  {
    key: 'invert',
    milkdrop2: 'bInvert',
    aliases: ['finvert'],
    editor: 'bInvert',
  },
  { key: 'wave_a', milkdrop2: 'fWaveAlpha' },
  { key: 'wave_scale', milkdrop2: 'fWaveScale' },
  { key: 'wave_smoothing', milkdrop2: 'fWaveSmoothing' },
  { key: 'wave_mystery', milkdrop2: 'fWaveParam' },
  { key: 'modwavealphastart', milkdrop2: 'fModWaveAlphaStart' },
  { key: 'modwavealphaend', milkdrop2: 'fModWaveAlphaEnd' },
  { key: 'warpanimspeed', milkdrop2: 'fWarpAnimSpeed' },
  { key: 'warp_scale', milkdrop2: 'fWarpScale' },
  { key: 'zoomexp', milkdrop2: 'fZoomExponent' },
  { key: 'shader', milkdrop2: 'fShader' },
  { key: 'zoom', milkdrop2: 'zoom', aliases: ['fzoom'] },
  { key: 'rot', milkdrop2: 'rot', aliases: ['frot'] },
  { key: 'cx', milkdrop2: 'cx', aliases: ['fcx'] },
  { key: 'cy', milkdrop2: 'cy', aliases: ['fcy'] },
  { key: 'dx', milkdrop2: 'dx', aliases: ['fdx'] },
  { key: 'dy', milkdrop2: 'dy', aliases: ['fdy'] },
  { key: 'warp', milkdrop2: 'warp', aliases: ['fwarp'] },
  { key: 'sx', milkdrop2: 'sx', aliases: ['fsx'] },
  { key: 'sy', milkdrop2: 'sy', aliases: ['fsy'] },
  { key: 'wave_r', milkdrop2: 'wave_r', aliases: ['fwaver'] },
  { key: 'wave_g', milkdrop2: 'wave_g', aliases: ['fwaveg'] },
  { key: 'wave_b', milkdrop2: 'wave_b', aliases: ['fwaveb'] },
  { key: 'wave_x', milkdrop2: 'wave_x', aliases: ['fwavex'] },
  { key: 'wave_y', milkdrop2: 'wave_y', aliases: ['fwavey'] },
  { key: 'ob_size', milkdrop2: 'ob_size', aliases: ['fouterbordersize'] },
  { key: 'ob_r', milkdrop2: 'ob_r', aliases: ['fouterborderr'] },
  { key: 'ob_g', milkdrop2: 'ob_g', aliases: ['fouterborderg'] },
  { key: 'ob_b', milkdrop2: 'ob_b', aliases: ['fouterborderb'] },
  { key: 'ob_a', milkdrop2: 'ob_a', aliases: ['fouterbordera'] },
  { key: 'ib_size', milkdrop2: 'ib_size', aliases: ['finnerbordersize'] },
  { key: 'ib_r', milkdrop2: 'ib_r', aliases: ['finnerborderr'] },
  { key: 'ib_g', milkdrop2: 'ib_g', aliases: ['finnerborderg'] },
  { key: 'ib_b', milkdrop2: 'ib_b', aliases: ['finnerborderb'] },
  { key: 'ib_a', milkdrop2: 'ib_a', aliases: ['finnerbordera'] },
  {
    key: 'motion_vectors_x',
    milkdrop2: 'nMotionVectorsX',
    aliases: ['motionvectorsx', 'mv_x'],
  },
  {
    key: 'motion_vectors_y',
    milkdrop2: 'nMotionVectorsY',
    aliases: ['motionvectorsy', 'mv_y'],
  },
  { key: 'mv_dx', milkdrop2: 'mv_dx' },
  { key: 'mv_dy', milkdrop2: 'mv_dy' },
  { key: 'mv_l', milkdrop2: 'mv_l', aliases: ['nmotionvectorsloop'] },
  { key: 'mv_r', milkdrop2: 'mv_r', aliases: ['fmotionvectorsr'] },
  { key: 'mv_g', milkdrop2: 'mv_g', aliases: ['fmotionvectorsg'] },
  { key: 'mv_b', milkdrop2: 'mv_b', aliases: ['fmotionvectorsb'] },
  { key: 'mv_a', milkdrop2: 'mv_a', aliases: ['fmotionvectorsa'] },
  { key: 'blur1_min', milkdrop2: 'b1n' },
  { key: 'blur2_min', milkdrop2: 'b2n' },
  { key: 'blur3_min', milkdrop2: 'b3n' },
  { key: 'blur1_max', milkdrop2: 'b1x' },
  { key: 'blur2_max', milkdrop2: 'b2x' },
  { key: 'blur3_max', milkdrop2: 'b3x' },

  // Written by the exporter's header, not the [preset00] block.
  { key: 'milkdrop_preset_version' },
  { key: 'psversion' },
  { key: 'psversion_warp' },
  { key: 'psversion_comp' },

  // Fields MilkDrop 2 has no [preset00] key for.
  { key: 'beat_sensitivity', aliases: ['fbeatsensitivity'] },
  { key: 'blend_duration', aliases: ['fblendtimeseconds'] },
  { key: 'video_echo_enabled', aliases: ['video_echo'] },
  { key: 'motion_vectors', aliases: ['bmotionvectorson'] },
];

/**
 * Spellings presets use for things Stims deliberately does not read. They
 * normalise to nothing, so the compiler keeps them verbatim for Format and
 * Export instead of treating them as unknown.
 */
export const IGNORED_FIELD_SPELLINGS: readonly string[] = [
  'nmotionvectorsdx',
  'nmotionvectorsdy',
  'b1ed',
  'nechowrap_x',
  'nechowrap_y',
  'nwrapmode_x',
  'nwrapmode_y',
];

/** Spellings of custom-shape fields that differ from Stims' suffix. */
export const SHAPE_FIELD_ALIASES: Readonly<Record<string, string>> = {
  tex_capture: 'textured',
};

const normalise = (spelling: string) =>
  spelling
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_');

/**
 * Every spelling a preset may use → the Stims key (or null for a spelling
 * Stims ignores). Identity entries are included only where the key itself
 * is not already lower case, so the lookup lands on the canonical casing.
 */
export function buildFieldAliasMap(): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const spec of MILKDROP_FIELDS) {
    const derived = [spec.key, ...(spec.milkdrop2 ? [spec.milkdrop2] : [])];
    for (const spelling of derived.map(normalise)) {
      if (spelling !== spec.key) map[spelling] = spec.key;
    }
    for (const spelling of (spec.aliases ?? []).map(normalise)) {
      map[spelling] = spec.key;
    }
    // Keys that are their own normalised form still map to themselves when
    // presets spell them in the header form (`PSVERSION`).
    if (spec.milkdrop2 === undefined && !spec.aliases) {
      map[normalise(spec.key)] = spec.key;
    }
  }
  for (const spelling of IGNORED_FIELD_SPELLINGS) {
    map[normalise(spelling)] = null;
  }
  for (const [spelling, suffix] of Object.entries(SHAPE_FIELD_ALIASES)) {
    map[normalise(spelling)] = suffix;
  }
  return map;
}

/** How Format writes a field (`decay` → `fDecay`). */
export function editorFieldKey(key: string): string {
  return EDITOR_KEYS[key] ?? key;
}

const EDITOR_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  MILKDROP_FIELDS.filter((spec) => spec.editor).map((spec) => [
    spec.key,
    spec.editor as string,
  ]),
);

/** MilkDrop 2's `[preset00]` fields, in its order: [its key, Stims key]. */
export const MILKDROP2_FIELD_PAIRS: ReadonlyArray<readonly [string, string]> =
  MILKDROP_FIELDS.filter((spec) => spec.milkdrop2).map(
    (spec) => [spec.milkdrop2 as string, spec.key] as const,
  );
