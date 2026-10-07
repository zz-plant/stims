const MAX_CUSTOM_WAVES = 32;
const MAX_CUSTOM_SHAPES = 32;

function createDefaultShapeSlot(index: number): Record<string, number> {
  return {
    [`shape_${index}_enabled`]: 0,
    [`shape_${index}_sides`]: 4,
    [`shape_${index}_num_inst`]: 1,
    [`shape_${index}_x`]: 0.5,
    [`shape_${index}_y`]: 0.5,
    [`shape_${index}_rad`]: 0.1,
    [`shape_${index}_ang`]: 0,
    [`shape_${index}_textured`]: 0,
    [`shape_${index}_tex_zoom`]: 1,
    [`shape_${index}_tex_ang`]: 0,
    [`shape_${index}_tex_cx`]: 0.5,
    [`shape_${index}_tex_cy`]: 0.5,
    [`shape_${index}_bdrawback`]: 0,
    [`shape_${index}_x_wrap_mode`]: 0,
    [`shape_${index}_y_wrap_mode`]: 0,
    [`shape_${index}_a`]: 1,
    [`shape_${index}_r`]: 1,
    [`shape_${index}_g`]: 0,
    [`shape_${index}_b`]: 0,
    [`shape_${index}_a2`]: 0,
    [`shape_${index}_r2`]: 0,
    [`shape_${index}_g2`]: 1,
    [`shape_${index}_b2`]: 0,
    [`shape_${index}_border_a`]: 0,
    [`shape_${index}_border_r`]: 1,
    [`shape_${index}_border_g`]: 1,
    [`shape_${index}_border_b`]: 1,
    [`shape_${index}_additive`]: 0,
    [`shape_${index}_thickoutline`]: 0,
    [`shape_${index}_psversion`]: 3,
  };
}

function createDefaultCustomWaveSlot(index: number): Record<string, number> {
  return {
    [`custom_wave_${index}_enabled`]: 0,
    [`custom_wave_${index}_samples`]: 512,
    [`custom_wave_${index}_sep`]: 0,
    [`custom_wave_${index}_spectrum`]: 0,
    [`custom_wave_${index}_additive`]: 0,
    [`custom_wave_${index}_usedots`]: 0,
    [`custom_wave_${index}_scaling`]: 1,
    [`custom_wave_${index}_smoothing`]: 0.5,
    [`custom_wave_${index}_mystery`]: 0,
    [`custom_wave_${index}_thick`]: 0,
    [`custom_wave_${index}_x`]: 0.5,
    [`custom_wave_${index}_y`]: 0.5,
    [`custom_wave_${index}_r`]: 1,
    [`custom_wave_${index}_g`]: 1,
    [`custom_wave_${index}_b`]: 1,
    [`custom_wave_${index}_a`]: 1,
    [`custom_wave_${index}_psversion`]: 3,
  };
}

const DEFAULT_MILKDROP_STATE: Record<string, number> = {
  fRating: 3,
  milkdrop_preset_version: 100,
  psversion: 2,
  psversion_comp: 2,
  psversion_warp: 2,
  beat_sensitivity: 0.5,
  blend_duration: 3,
  blur1_min: 0,
  blur1_max: 1,
  blur2_min: 0,
  blur2_max: 1,
  blur3_min: 0,
  blur3_max: 1,
  basstime: 0,
  decay: 0.98,
  zoom: 1,
  zoomexp: 1,
  rot: 0,
  warp: 1,
  warp_scale: 1,
  cx: 0.5,
  cy: 0.5,
  sx: 1,
  sy: 1,
  dx: 0,
  dy: 0,
  warpanimspeed: 1,
  shader: 0,
  // MilkDrop builtin defaults: presets with bModWaveAlphaByVolume=1 that omit
  // these expect the wave to fade in below vol≈0.75 and reach full alpha at
  // vol≈0.95 (vol is the mean of the relative bands, ~1 during music).
  modwavealphastart: 0.75,
  modwavealphaend: 0.95,
  bmodwavealphabyvolume: 0,
  wave_mode: 0,
  wave_scale: 1,
  // Defaults below match projectM's PresetState.hpp, which implements
  // MilkDrop's own initial state. Every field a preset omits used to fall back
  // to 0 here; the Butterchurn-derived import omits ~84 declared fields per
  // preset (it only serializes non-defaults), so those zeros were what the
  // renderer actually used for most of the catalog — a white wave became
  // black, smoothing vanished, motion vectors drew invisible grids.
  wave_smoothing: 0.75,
  wave_a: 0.8,
  wave_r: 1,
  wave_g: 1,
  wave_b: 1,
  // MilkDrop centers the main wave by default (0.5/0.5); 0 would park it at
  // a screen corner, leaving only a clipped sliver visible for every preset
  // that doesn't set fWaveX/fWaveY explicitly.
  wave_x: 0.5,
  wave_y: 0.5,
  wave_mystery: 0,
  wave_thick: 0,
  wave_additive: 0,
  wave_usedots: 0,
  // bMaximizeWaveColor; projectM's maximizeWaveColor defaults to true.
  wave_brighten: 1,
  mesh_density: 32,
  mesh_x: 32,
  mesh_y: 24,
  mesh_alpha: 0,
  mesh_r: 1,
  mesh_g: 1,
  mesh_b: 1,
  bg_r: 0,
  bg_g: 0,
  bg_b: 0,
  brighten: 0,
  darken: 0,
  darken_center: 0,
  solarize: 0,
  invert: 0,
  red_blue_stereo: 0,
  // MilkDrop's composite gamma, and the default a preset inherits by omitting
  // `fGammaAdj` — 291 of the 2,686 bundled presets do.
  //
  // MEASURED, not inferred: apply a comp shader that outputs a constant via
  // `__STIMS_AGENT_BRIDGE__.applyEditorSource`, pump frames, read the canvas
  // back. Across inputs 0.05/0.1/0.25/0.5/0.75/0.9 the implied exponent is
  // 0.500/0.498/0.503/0.503/0.497/0.497 — the present path applies
  // `out = in^(1/gammaAdj)`. It is not an sRGB encode and not colour
  // management, and three separate attempts to derive it from the renderer
  // source got it wrong.
  //
  // Do NOT "correct" this to 1 on the strength of projectM's
  // `presetOutputs->fGammaAdj = 1.0` (MilkdropPresetFactory.cpp:90 and :178).
  // That line is an initialisation the preset parser overwrites. Setting it to
  // 1 here was measured and destroys the two certified presets that pass:
  // 100-square 1.43% -> 85.74% against a 0.5pp band, and 250-wavecode
  // 8.41% -> 55.33%. Both omit fGammaAdj, so if projectM rendered them at
  // gamma 1 they would have improved.
  gammaadj: 2,
  video_echo_enabled: 0,
  video_echo_alpha: 0,
  video_echo_zoom: 2,
  video_echo_orientation: 0,
  ob_size: 0.01,
  ob_r: 0,
  ob_g: 0,
  ob_b: 0,
  // Both borders default to alpha 0: sized and colored, but not drawn until a
  // preset asks for them.
  ob_a: 0,
  ib_size: 0.01,
  ib_r: 0.25,
  ib_g: 0.25,
  ib_b: 0.25,
  ib_a: 0,
  texture_wrap: 1,
  feedback_texture: 0,
  ob_border: 0,
  ib_border: 0,
  motion_vectors: 0,
  motion_vectors_x: 12,
  motion_vectors_y: 9,
  // Genuinely per-preset — projectM starts both at 0 and so do the originals.
  mv_dx: 0,
  mv_dy: 0,
  mv_l: 0.9,
  mv_r: 1,
  mv_g: 1,
  mv_b: 1,
  // mv_a stays 0: projectM's mvA defaults to 0, so a preset that omits it
  // draws no motion vectors at all. (Sampling the originals suggested 1, but
  // that sample only contained presets which *declared* mv_a — the ones that
  // declared 0 matched our old default and never showed up as a divergence.)
  mv_a: 0,
  ...Object.fromEntries(
    Array.from({ length: MAX_CUSTOM_SHAPES }, (_, index) =>
      Object.entries(createDefaultShapeSlot(index + 1)),
    ).flat(),
  ),
  ...Object.fromEntries(
    Array.from({ length: MAX_CUSTOM_WAVES }, (_, index) =>
      Object.entries(createDefaultCustomWaveSlot(index + 1)),
    ).flat(),
  ),
};

export {
  createDefaultCustomWaveSlot,
  createDefaultShapeSlot,
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
};
