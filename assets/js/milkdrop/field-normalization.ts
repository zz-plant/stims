const aliasMap: Record<string, string | null> = {
  milkdrop_preset_version: null,
  frating: 'fRating',
  fdecay: 'decay',
  fgammaadj: 'gammaadj',
  fvideoechozoom: 'video_echo_zoom',
  fvideoechoalpha: 'video_echo_alpha',
  nvideoechoorientation: 'video_echo_orientation',
  bredbluestereo: 'red_blue_stereo',
  redbluestereo: 'red_blue_stereo',
  fwavealpha: 'wave_a',
  fwavethick: 'wave_thick',
  fwavescale: 'wave_scale',
  fwavesmoothing: 'wave_smoothing',
  nwavemode: 'wave_mode',
  fmodwavealphastart: 'modwavealphastart',
  fmodwavealphaend: 'modwavealphaend',
  modwavealphabyvolume: 'bmodwavealphabyvolume',
  bmodwavealphabyvolume: 'bmodwavealphabyvolume',
  fwarpscale: 'warp',
  fwarpanimspeed: 'warpanimspeed',
  fzoomexponent: 'zoomexp',
  fshader: 'shader',
  fbrighten: 'brighten',
  fdarken: 'darken',
  bdarkencenter: 'darken_center',
  fsolarize: 'solarize',
  finvert: 'invert',
  badditivewaves: 'wave_additive',
  additivewaves: 'wave_additive',
  waveadditive: 'wave_additive',
  bwavedots: 'wave_usedots',
  wavedots: 'wave_usedots',
  waveusedots: 'wave_usedots',
  bwavethick: 'wave_thick',
  wavethick: 'wave_thick',
  bmaximizewavecolor: 'wave_brighten',
  bbrighten: 'brighten',
  bdarken: 'darken',
  btexwrap: 'texture_wrap',
  bsolarize: 'solarize',
  binvert: 'invert',
  fwaveparam: 'wave_mystery',
  fwaver: 'wave_r',
  fwaveg: 'wave_g',
  fwaveb: 'wave_b',
  fwavex: 'wave_x',
  fwavey: 'wave_y',
  fbeatsensitivity: 'beat_sensitivity',
  fblendtimeseconds: 'blend_duration',
  fouterbordersize: 'ob_size',
  fouterborderr: 'ob_r',
  fouterborderg: 'ob_g',
  fouterborderb: 'ob_b',
  fouterbordera: 'ob_a',
  finnerbordersize: 'ib_size',
  finnerborderr: 'ib_r',
  finnerborderg: 'ib_g',
  finnerborderb: 'ib_b',
  finnerbordera: 'ib_a',
  video_echo: 'video_echo_enabled',
  echo_orient: 'video_echo_orientation',
  motionvectorsx: 'motion_vectors_x',
  motionvectorsy: 'motion_vectors_y',
  nmotionvectorsx: 'motion_vectors_x',
  nmotionvectorsy: 'motion_vectors_y',
  mv_x: 'motion_vectors_x',
  mv_y: 'motion_vectors_y',
};

export function normalizeFieldSuffix(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_');
}

export function normalizeProgramAssignmentTarget(target: string) {
  const normalizedTarget = normalizeFieldSuffix(target);
  const aliasedTarget = aliasMap[normalizedTarget];
  return aliasedTarget ?? normalizedTarget;
}

export function resolveMilkdropIdentifier(
  env: Record<string, number>,
  identifier: string,
) {
  const normalizedIdentifier = normalizeFieldSuffix(identifier);
  const aliasedIdentifier = aliasMap[normalizedIdentifier];

  return (
    env[identifier] ??
    env[normalizedIdentifier] ??
    (aliasedIdentifier ? env[aliasedIdentifier] : undefined)
  );
}

export { aliasMap };
