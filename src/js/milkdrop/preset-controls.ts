/**
 * The Tune pane's control catalogue, as data.
 *
 * MilkDrop stores everything as a bare float, which says nothing about how a
 * value behaves: `bBrighten` is a switch, `nWaveMode` picks one of eight
 * shapes, `zoom` is a multiplier where 1 means "unchanged", `fDecay` lives in
 * the last 2% of its own range, and `blur1_min`/`blur1_max` are two ends of
 * one thing. Rendering all of them as identical 0..1 faders is what made the
 * pane a wall of numbers. These declarations carry the missing half.
 */

export type ScaleKind =
  /** Value maps straight onto the track. */
  | 'linear'
  /** Multiplier around 1. The track is logarithmic within each half and the
   * neutral value is pinned to the centre. When the bounds are asymmetric
   * (zoom is 0.2..3, a 5x range below neutral and 3x above) the two halves
   * therefore have different ratio-per-pixel — a deliberate trade, because a
   * neutral you can find beats uniformity across the whole track. */
  | 'ratio'
  /** Feedback retention just under 1, reparameterised as a trail half-life in
   * seconds. `decay=0.98` is a quarter-second tail; `decay=0.999` is fifteen
   * seconds. On a linear 0.8..1.0 track those are 3px apart. */
  | 'retention';

export type ScalarControlConfig = {
  label: string;
  key: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  scale: ScaleKind;
  /** Value the track centres on, for controls whose neutral is not the
   * midpoint. Used to draw the detent and to snap near it. */
  neutral?: number;
  unit?: string;
  hint?: string;
};

export type ToggleControlConfig = {
  label: string;
  key: string;
  defaultValue: 0 | 1;
  /** Grouping in the pane. Post-processing toggles are an ordered chain and
   * read as one thing; the wave flags are independent. */
  group: 'post' | 'wave' | 'frame';
  hint: string;
};

export type EnumControlConfig = {
  label: string;
  key: string;
  defaultValue: number;
  options: Array<{ value: number; label: string; hint?: string }>;
  hint: string;
};

export type RangeControlConfig = {
  label: string;
  minKey: string;
  maxKey: string;
  /** Track bounds, not the preset's values. */
  min: number;
  max: number;
  step: number;
  defaultMin: number;
  defaultMax: number;
  hint: string;
};

export type ColorGroupConfig = {
  label: string;
  rgb: [string, string, string];
  /** MilkDrop is inconsistent about the suffix — the main wave uses `wave_a`,
   * the solid mesh uses `mesh_alpha` — so the group carries the real name. */
  alpha: { key: string; defaultValue: number } | null;
  defaultRgb: [number, number, number];
  hint: string;
};

// ── Scales ──────────────────────────────────────────────────────────

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export const clamp01 = (value: number) => clamp(value, 0, 1);

/**
 * Half-life in seconds for a per-frame retention factor, assuming 60fps.
 * `decay` multiplies the previous frame every frame, so the tail length is
 * log(0.5)/log(decay) frames.
 */
export function retentionToSeconds(decay: number, fps = 60): number {
  const safe = clamp(decay, 0.5, 0.9999);
  if (safe >= 0.9999) return 30;
  return Math.log(0.5) / Math.log(safe) / fps;
}

export function secondsToRetention(seconds: number, fps = 60): number {
  const safe = clamp(seconds, 0.01, 30);
  return clamp(0.5 ** (1 / (safe * fps)), 0.5, 0.9999);
}

/**
 * Maps a control value onto a 0..1 track position for its scale.
 *
 * `ratio` uses log space so that halving and doubling are the same distance
 * from centre, and pins the neutral value to exactly 0.5 whatever the bounds
 * are — otherwise "no change" sits at an arbitrary spot on the track and the
 * user has to hunt for it.
 */
export function valueToPosition(
  value: number,
  config: Pick<ScalarControlConfig, 'min' | 'max' | 'scale' | 'neutral'>,
): number {
  const { min, max, scale } = config;
  if (scale === 'ratio') {
    const neutral = config.neutral ?? 1;
    const v = clamp(value, min, max);
    if (v >= neutral) {
      const span = Math.log(max) - Math.log(neutral);
      return span <= 0
        ? 0.5
        : 0.5 + (0.5 * (Math.log(v) - Math.log(neutral))) / span;
    }
    const span = Math.log(neutral) - Math.log(min);
    return span <= 0
      ? 0.5
      : 0.5 - (0.5 * (Math.log(neutral) - Math.log(v))) / span;
  }
  if (scale === 'retention') {
    const seconds = retentionToSeconds(clamp(value, min, max));
    const lo = Math.log(retentionToSeconds(min));
    const hi = Math.log(retentionToSeconds(max));
    return hi <= lo ? 0 : clamp01((Math.log(seconds) - lo) / (hi - lo));
  }
  return max <= min ? 0 : clamp01((value - min) / (max - min));
}

export function positionToValue(
  position: number,
  config: Pick<ScalarControlConfig, 'min' | 'max' | 'scale' | 'neutral'>,
): number {
  const { min, max, scale } = config;
  const p = clamp01(position);
  if (scale === 'ratio') {
    const neutral = config.neutral ?? 1;
    if (p >= 0.5) {
      const span = Math.log(max) - Math.log(neutral);
      return Math.exp(Math.log(neutral) + ((p - 0.5) / 0.5) * span);
    }
    const span = Math.log(neutral) - Math.log(min);
    return Math.exp(Math.log(neutral) - ((0.5 - p) / 0.5) * span);
  }
  if (scale === 'retention') {
    const lo = Math.log(retentionToSeconds(min));
    const hi = Math.log(retentionToSeconds(max));
    return secondsToRetention(Math.exp(lo + p * (hi - lo)));
  }
  return min + p * (max - min);
}

/** What the control shows beside its label. Ratios read as ×, retention as a
 * tail length, everything else as the raw value the preset holds. */
export function formatControlValue(
  value: number,
  config: Pick<ScalarControlConfig, 'scale' | 'unit'>,
): string {
  if (config.scale === 'retention') {
    const seconds = retentionToSeconds(value);
    return seconds >= 10
      ? `${seconds.toFixed(0)}s tail`
      : `${seconds.toFixed(2)}s tail`;
  }
  if (config.scale === 'ratio') {
    return `${value.toFixed(2)}×`;
  }
  return `${value.toFixed(2)}${config.unit ?? ''}`;
}

// ── Catalogue ───────────────────────────────────────────────────────

export const SCALAR_CONTROLS: ScalarControlConfig[] = [
  {
    label: 'Zoom',
    key: 'zoom',
    min: 0.2,
    max: 3.0,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'Per-frame scale of the previous frame. 1× holds still.',
  },
  {
    label: 'Warp',
    key: 'warp',
    min: 0.01,
    max: 10.0,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'Amount of the ripple distortion.',
  },
  {
    label: 'Rot',
    key: 'rot',
    min: -1.0,
    max: 1.0,
    step: 0.005,
    defaultValue: 0.0,
    scale: 'linear',
    neutral: 0,
    hint: 'Rotation per frame, in radians.',
  },
  {
    label: 'Decay',
    key: 'decay',
    min: 0.8,
    max: 0.999,
    step: 0.0005,
    defaultValue: 0.98,
    scale: 'retention',
    hint: 'How long the previous frame lingers.',
  },
  // Also draggable directly on the stage. Kept here as well because the
  // gizmo needs the stage visible, and the panel covers it on a narrow
  // screen — and because a keyboard user gets a numeric track either way.
  {
    label: 'Centre X',
    key: 'cx',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.5,
    scale: 'linear',
    neutral: 0.5,
    hint: 'Horizontal centre of zoom, rotation and warp.',
  },
  {
    label: 'Centre Y',
    key: 'cy',
    min: 0,
    max: 1,
    step: 0.005,
    defaultValue: 0.5,
    scale: 'linear',
    neutral: 0.5,
    hint: 'Vertical centre of zoom, rotation and warp. 0 is the top.',
  },
  {
    label: 'Scale X',
    key: 'sx',
    min: 0.1,
    max: 3.0,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'Horizontal stretch of the warp mesh.',
  },
  {
    label: 'Scale Y',
    key: 'sy',
    min: 0.1,
    max: 3.0,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'Vertical stretch of the warp mesh.',
  },
  {
    label: 'Shift X',
    key: 'dx',
    min: -0.5,
    max: 0.5,
    step: 0.005,
    defaultValue: 0.0,
    scale: 'linear',
    neutral: 0,
    hint: 'Horizontal drift per frame.',
  },
  {
    label: 'Shift Y',
    key: 'dy',
    min: -0.5,
    max: 0.5,
    step: 0.005,
    defaultValue: 0.0,
    scale: 'linear',
    neutral: 0,
    hint: 'Vertical drift per frame.',
  },
  {
    label: 'Warp scale',
    key: 'warp_scale',
    min: 0.01,
    max: 10,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'Spatial frequency of the ripple.',
  },
  {
    label: 'Warp speed',
    key: 'warpanimspeed',
    min: 0.01,
    max: 8,
    step: 0.001,
    defaultValue: 1.0,
    scale: 'ratio',
    neutral: 1,
    hint: 'How fast the ripple animates.',
  },
  {
    label: 'Gamma',
    key: 'gammaadj',
    min: 0.2,
    max: 8,
    step: 0.001,
    defaultValue: 2,
    scale: 'ratio',
    neutral: 1,
    hint: 'Output gamma. Above 1 lifts the midtones.',
  },
  {
    label: 'Echo zoom',
    key: 'video_echo_zoom',
    min: 0.2,
    max: 4,
    step: 0.001,
    defaultValue: 2,
    scale: 'ratio',
    neutral: 1,
    hint: 'Scale of the echo copy.',
  },
  {
    label: 'Echo alpha',
    key: 'video_echo_alpha',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0,
    scale: 'linear',
    hint: 'Strength of the echo copy. 0 disables it.',
  },
  {
    label: 'Border size',
    key: 'ob_size',
    min: 0.0,
    max: 0.5,
    step: 0.005,
    defaultValue: 0.01,
    scale: 'linear',
    hint: 'Thickness of the outer border.',
  },
];

/**
 * Ordered as the frame is actually processed, so the row reads as the pipeline
 * it is rather than an alphabetical pile of flags.
 */
export const TOGGLE_CONTROLS: ToggleControlConfig[] = [
  {
    label: 'Brighten',
    key: 'brighten',
    defaultValue: 0,
    group: 'post',
    hint: 'Pushes the frame toward white.',
  },
  {
    label: 'Darken',
    key: 'darken',
    defaultValue: 0,
    group: 'post',
    hint: 'Pushes the frame toward black.',
  },
  {
    label: 'Solarize',
    key: 'solarize',
    defaultValue: 0,
    group: 'post',
    hint: 'Inverts only the bright half of the range.',
  },
  {
    label: 'Invert',
    key: 'invert',
    defaultValue: 0,
    group: 'post',
    hint: 'Inverts the whole frame.',
  },
  {
    label: 'Darken centre',
    key: 'darken_center',
    defaultValue: 0,
    group: 'post',
    hint: 'Bleeds the middle of the frame darker each frame.',
  },
  {
    label: 'Red/blue 3D',
    key: 'red_blue_stereo',
    defaultValue: 0,
    group: 'post',
    hint: 'Anaglyph split. Needs red/cyan glasses to read as depth.',
  },
  {
    label: 'Echo',
    key: 'video_echo_enabled',
    defaultValue: 0,
    group: 'post',
    hint: 'Draws a scaled copy over the frame; see Echo zoom/alpha.',
  },
  {
    label: 'Wrap edges',
    key: 'texture_wrap',
    defaultValue: 1,
    group: 'frame',
    hint: 'Warp samples wrap around the edges instead of clamping.',
  },
  {
    label: 'Motion vectors',
    key: 'motion_vectors',
    defaultValue: 0,
    group: 'frame',
    hint: 'Draws the flow grid. Its alpha defaults to 0 as well.',
  },
  {
    label: 'Additive wave',
    key: 'wave_additive',
    defaultValue: 0,
    group: 'wave',
    hint: 'Wave adds to the frame instead of covering it.',
  },
  {
    label: 'Dotted wave',
    key: 'wave_usedots',
    defaultValue: 0,
    group: 'wave',
    hint: 'Draws the waveform as points, not a line.',
  },
  {
    label: 'Thick wave',
    key: 'wave_thick',
    defaultValue: 0,
    group: 'wave',
    hint: 'Doubles the waveform line width.',
  },
  {
    label: 'Max wave colour',
    key: 'wave_brighten',
    defaultValue: 1,
    group: 'wave',
    hint: 'Normalises the wave colour to full brightness.',
  },
  {
    label: 'Wave alpha by volume',
    key: 'bmodwavealphabyvolume',
    defaultValue: 0,
    group: 'wave',
    hint: 'Fades the wave in with loudness; see the Wave alpha range.',
  },
];

export const ENUM_CONTROLS: EnumControlConfig[] = [
  {
    label: 'Wave mode',
    key: 'wave_mode',
    defaultValue: 0,
    hint: 'Which of the eight built-in waveform shapes is drawn.',
    options: [
      { value: 0, label: 'Circle' },
      { value: 1, label: 'X-Y pair' },
      { value: 2, label: 'Centred' },
      { value: 3, label: 'Explosive' },
      { value: 4, label: 'Line' },
      { value: 5, label: 'Double line' },
      { value: 6, label: 'Spectrum' },
      { value: 7, label: 'Dual spectrum' },
    ],
  },
  {
    label: 'Echo orientation',
    key: 'video_echo_orientation',
    defaultValue: 0,
    hint: 'How the echo copy is flipped.',
    options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Flip X' },
      { value: 2, label: 'Flip Y' },
      { value: 3, label: 'Flip both' },
    ],
  },
];

export const RANGE_CONTROLS: RangeControlConfig[] = [
  {
    label: 'Blur 1',
    minKey: 'blur1_min',
    maxKey: 'blur1_max',
    min: 0,
    max: 1,
    step: 0.01,
    defaultMin: 0,
    defaultMax: 1,
    hint: 'Output range the first blur pass is remapped into.',
  },
  {
    label: 'Blur 2',
    minKey: 'blur2_min',
    maxKey: 'blur2_max',
    min: 0,
    max: 1,
    step: 0.01,
    defaultMin: 0,
    defaultMax: 1,
    hint: 'Second blur pass, fed by the first.',
  },
  {
    label: 'Blur 3',
    minKey: 'blur3_min',
    maxKey: 'blur3_max',
    min: 0,
    max: 1,
    step: 0.01,
    defaultMin: 0,
    defaultMax: 1,
    hint: 'Third and widest blur pass.',
  },
  {
    label: 'Wave alpha',
    minKey: 'modwavealphastart',
    maxKey: 'modwavealphaend',
    min: 0,
    max: 2,
    step: 0.01,
    defaultMin: 0.75,
    defaultMax: 0.95,
    hint: 'Loudness at which the wave starts fading in and reaches full alpha. Only used when "Wave alpha by volume" is on.',
  },
];

/**
 * MilkDrop stores every colour as separate 0..1 scalars, so a preset's palette
 * arrives as ~21 unrelated numbers. Editing them as faders means guessing what
 * (0.65, 0.20, 0.90) looks like and moving three controls to shift one hue.
 */
export const COLOR_GROUPS: ColorGroupConfig[] = [
  {
    label: 'Background',
    rgb: ['bg_r', 'bg_g', 'bg_b'],
    alpha: null,
    defaultRgb: [0, 0, 0],
    hint: 'Cleared behind everything each frame.',
  },
  {
    label: 'Wave',
    rgb: ['wave_r', 'wave_g', 'wave_b'],
    alpha: { key: 'wave_a', defaultValue: 0.8 },
    defaultRgb: [1, 1, 1],
    hint: 'The main waveform. Most presets recolour this per frame.',
  },
  {
    label: 'Motion vectors',
    rgb: ['mv_r', 'mv_g', 'mv_b'],
    alpha: { key: 'mv_a', defaultValue: 0 },
    defaultRgb: [1, 1, 1],
    hint: 'Alpha defaults to 0 — the grid is invisible until you raise it.',
  },
  {
    label: 'Outer border',
    rgb: ['ob_r', 'ob_g', 'ob_b'],
    alpha: { key: 'ob_a', defaultValue: 0 },
    defaultRgb: [0, 0, 0],
    hint: 'Sized by Border size; drawn only once alpha is above 0.',
  },
  {
    label: 'Inner border',
    rgb: ['ib_r', 'ib_g', 'ib_b'],
    alpha: { key: 'ib_a', defaultValue: 0 },
    defaultRgb: [0.25, 0.25, 0.25],
    hint: 'Drawn only once alpha is above 0.',
  },
  {
    label: 'Solid mesh',
    rgb: ['mesh_r', 'mesh_g', 'mesh_b'],
    alpha: { key: 'mesh_alpha', defaultValue: 0 },
    defaultRgb: [1, 1, 1],
    hint: 'A flat tint over the frame; alpha 0 by default.',
  },
];

/** MilkDrop channels are plain 0..1 multipliers, so the mapping to a colour
 * input is direct — no gamma step, which would misreport what the preset
 * actually holds. Values above 1 (presets do overdrive them) clamp for
 * display only. */
export function channelsToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function hexToChannels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 1, 2].map(
    (index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16) / 255,
  ) as [number, number, number];
}
