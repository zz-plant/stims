import fs from 'node:fs';
import path from 'node:path';

const BUTTERCHURN_PACKAGE = 'butterchurn-presets';
const PRESETS_DIR = path.join(
  import.meta.dir,
  '..',
  'node_modules',
  BUTTERCHURN_PACKAGE,
  'presets',
  'converted',
);
const OUTPUT_DIR = path.join(
  import.meta.dir,
  '..',
  'public',
  'milkdrop-presets',
  'butterchurn',
);
const CATALOG_PATH = path.join(
  import.meta.dir,
  '..',
  'public',
  'milkdrop-presets',
  'catalog.json',
);

const MILKDROP_FIELD_MAP: Record<string, string> = {
  // Int/Float fields
  rating: 'fRating',
  gammaadj: 'fGammaAdj',
  decay: 'fDecay',
  echo_zoom: 'fVideoEchoZoom',
  echo_alpha: 'fVideoEchoAlpha',
  echo_orient: 'nVideoEchoOrientation',
  wave_mode: 'nWaveMode',
  wave_a: 'fWaveAlpha',
  wave_scale: 'fWaveScale',
  wave_smoothing: 'fWaveSmoothing',
  wave_mystery: 'fWaveParam',
  modwavealphastart: 'fModWaveAlphaStart',
  modwavealphaend: 'fModWaveAlphaEnd',
  warpanimspeed: 'fWarpAnimSpeed',
  warpscale: 'fWarpScale',
  zoomexp: 'fZoomExponent',
  fshader: 'fShader',
  zoom: 'fZoom',
  rot: 'fRot',
  cx: 'fCX',
  cy: 'fCY',
  dx: 'fDX',
  dy: 'fDY',
  sx: 'fSx',
  sy: 'fSy',
  wave_x: 'fWaveX',
  wave_y: 'fWaveY',
  wave_r: 'fWaveR',
  wave_g: 'fWaveG',
  wave_b: 'fWaveB',
  warp: 'fWarp',
  mv_x: 'nMotionVectorsX',
  mv_y: 'nMotionVectorsY',
  mv_dx: 'nMotionVectorsDx',
  mv_dy: 'nMotionVectorsDy',
  mv_l: 'nMotionVectorsLoop',
  mv_r: 'fMotionVectorsR',
  mv_g: 'fMotionVectorsG',
  mv_b: 'fMotionVectorsB',
  mv_a: 'fMotionVectorsA',
  ob_size: 'fOuterBorderSize',
  ob_r: 'fOuterBorderR',
  ob_g: 'fOuterBorderG',
  ob_b: 'fOuterBorderB',
  ob_a: 'fOuterBorderA',
  ib_size: 'fInnerBorderSize',
  ib_r: 'fInnerBorderR',
  ib_g: 'fInnerBorderG',
  ib_b: 'fInnerBorderB',
  ib_a: 'fInnerBorderA',
  beat_sensitivity: 'fBeatSensitivity',
  blend_duration: 'fBlendTimeSeconds',

  // Boolean fields
  additivewave: 'bAdditiveWaves',
  wave_dots: 'bWaveDots',
  wave_thick: 'bWaveThick',
  modwavealphabyvolume: 'bModWaveAlphaByVolume',
  wave_brighten: 'bMaximizeWaveColor',
  wrap: 'bTexWrap',
  darken_center: 'bDarkenCenter',
  red_blue: 'bRedBlueStereo',
  brighten: 'bBrighten',
  darken: 'bDarken',
  solarize: 'bSolarize',
  invert: 'bInvert',
  redbluestereo: 'bRedBlueStereo',
  bmotionvectorson: 'bMotionVectorsOn',
  video_echo_enabled: 'bVideoEchoEnabled',
  texture_wrap: 'bTexWrap',
};

const WAVE_FIELD_MAP: Record<string, string> = {
  enabled: 'bEnabled',
  samples: 'nSamples',
  sep: 'fSeparation',
  scaling: 'fScaling',
  smoothing: 'fSmoothing',
  r: 'fR',
  g: 'fG',
  b: 'fB',
  a: 'fA',
  spectrum: 'bSpectrum',
  usedots: 'bUseDots',
  thick: 'bThick',
  additive: 'bAdditive',
};

const SHAPE_FIELD_MAP: Record<string, string> = {
  enabled: 'bEnabled',
  sides: 'nSides',
  additive: 'bAdditive',
  thickoutline: 'bThickOutline',
  textured: 'bTextured',
  num_inst: 'nInstances',
  tex_zoom: 'fTexZoom',
  tex_ang: 'fTexAng',
  x: 'fX',
  y: 'fY',
  rad: 'fRad',
  ang: 'fAng',
  r: 'fR',
  g: 'fG',
  b: 'fB',
  a: 'fA',
  r2: 'fR2',
  g2: 'fG2',
  b2: 'fB2',
  a2: 'fA2',
  border_r: 'fBorderR',
  border_g: 'fBorderG',
  border_b: 'fBorderB',
  border_a: 'fBorderA',
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'preset'
  );
}

function extractAuthor(title: string): string {
  const dashIdx = title.indexOf(' - ');
  if (dashIdx === -1) return 'Unknown';
  const authorPart = title.slice(0, dashIdx).trim();
  return authorPart.replace(/\s*\(.*?\)\s*/g, '').trim() || 'Unknown';
}

function formatNumber(val: number): string {
  if (Number.isInteger(val)) {
    return val.toFixed(6);
  }
  return val.toFixed(6);
}

function serializeBaseVals(
  baseVals: Record<string, number>,
  fieldMap: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const [shortKey, val] of Object.entries(baseVals)) {
    const milkKey = fieldMap[shortKey] ?? shortKey;
    lines.push(`${milkKey}=${formatNumber(val)}`);
  }
  return lines.join('\n');
}

function getPresetVersion(baseVals: Record<string, number>): number {
  return (
    (baseVals as { milkdrop_preset_version?: number })
      .milkdrop_preset_version ?? 2
  );
}

type PresetShape = {
  baseVals: Record<string, number>;
  init_eqs_eel?: string;
  frame_eqs_eel?: string;
};

type PresetWave = {
  baseVals: Record<string, number>;
  init_eqs_eel?: string;
  frame_eqs_eel?: string;
  point_eqs_eel?: string;
};

type ButterchurnPreset = {
  version: number;
  baseVals: Record<string, number>;
  shapes: PresetShape[];
  waves: PresetWave[];
  init_eqs_eel?: string;
  frame_eqs_eel?: string;
  pixel_eqs_eel?: string;
  warp?: string;
  comp?: string;
};

function presetToMilkContent(preset: ButterchurnPreset): string {
  const parts: string[] = [];

  // Main preset section
  parts.push('[preset00]');
  parts.push(serializeBaseVals(preset.baseVals, MILKDROP_FIELD_MAP));
  parts.push('');

  // Shape sections
  for (let i = 0; i < preset.shapes.length; i++) {
    const shape = preset.shapes[i];
    const hasContent =
      Object.keys(shape.baseVals).length > 0 ||
      (shape.init_eqs_eel?.length ?? 0) > 0 ||
      (shape.frame_eqs_eel?.length ?? 0) > 0;

    if (!hasContent) continue;

    parts.push(`[shape00_${i}]`);
    parts.push(serializeBaseVals(shape.baseVals, SHAPE_FIELD_MAP));
    parts.push('');
  }

  // Wave sections
  for (let i = 0; i < preset.waves.length; i++) {
    const wave = preset.waves[i];
    const hasContent =
      Object.keys(wave.baseVals).length > 0 ||
      (wave.init_eqs_eel?.length ?? 0) > 0 ||
      (wave.frame_eqs_eel?.length ?? 0) > 0;

    if (!hasContent) continue;

    parts.push(`[wave00_${i}]`);
    parts.push(serializeBaseVals(wave.baseVals, WAVE_FIELD_MAP));
    parts.push('');
  }

  // EEL equations
  if (preset.init_eqs_eel?.trim()) {
    parts.push('[init_eqs]');
    parts.push(preset.init_eqs_eel.trim());
    parts.push('');
  }

  if (preset.frame_eqs_eel?.trim()) {
    parts.push('[frame_eqs]');
    parts.push(preset.frame_eqs_eel.trim());
    parts.push('');
  }

  if (preset.pixel_eqs_eel?.trim()) {
    parts.push('[pixel_eqs]');
    parts.push(preset.pixel_eqs_eel.trim());
    parts.push('');
  }

  // Shader code
  if (preset.warp?.trim()) {
    parts.push('[warp_shader]');
    parts.push(preset.warp.trim());
    parts.push('');
  }

  if (preset.comp?.trim()) {
    parts.push('[comp_shader]');
    parts.push(preset.comp.trim());
    parts.push('');
  }

  return `${parts.join('\n').trim()}\n`;
}

function loadExistingCatalog(): {
  presets: Record<string, number>;
} {
  const defaultCatalog = { presets: {} as Record<string, number> };

  if (!fs.existsSync(CATALOG_PATH)) {
    return defaultCatalog;
  }

  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const existing: Record<string, number> = {};
    const presetList = parsed.presets ?? [];
    for (let i = 0; i < presetList.length; i++) {
      existing[presetList[i].id] = i;
    }
    return { presets: existing };
  } catch {
    return defaultCatalog;
  }
}

async function main() {
  const packageDir = path.join(
    import.meta.dir,
    '..',
    'node_modules',
    BUTTERCHURN_PACKAGE,
  );
  if (!fs.existsSync(packageDir)) {
    console.error(
      `Package ${BUTTERCHURN_PACKAGE} not installed. Run: bun add --dev ${BUTTERCHURN_PACKAGE}`,
    );
    process.exit(1);
  }

  if (!fs.existsSync(PRESETS_DIR)) {
    console.error(
      `Presets directory not found at ${PRESETS_DIR}. Is the package installed correctly?`,
    );
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs
    .readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const existingCatalog = loadExistingCatalog();
  const newEntries: Array<{
    id: string;
    title: string;
    author: string;
    file: string;
    order: number;
    preview: boolean;
    tags: string[];
    expectedFidelityClass: string;
    visualEvidenceTier: string;
    supports: { webgl: boolean; webgpu: boolean };
    visualCertification: {
      status: string;
      measured: boolean;
      source: string;
      fidelityClass: string;
      visualEvidenceTier: string;
      requiredBackend: string;
      actualBackend: null;
      reasons: string[];
    };
  }> = [];

  let importedCount = 0;
  let skippedCount = 0;

  // Determine next order number
  const existingIds = new Set(Object.keys(existingCatalog.presets));
  let nextOrder = 1;
  for (const entry of Object.entries(existingCatalog.presets)) {
    if ((entry[1] as number) + 1 > nextOrder) {
      nextOrder = (entry[1] as number) + 1;
    }
  }

  for (const file of files) {
    const filePath = path.join(PRESETS_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');

    let preset: ButterchurnPreset;
    try {
      preset = JSON.parse(raw);
    } catch (e) {
      console.error(`  Failed to parse ${file}: ${e}`);
      continue;
    }

    const title = file.replace(/\.json$/, '');
    const id = slugify(title);

    if (existingIds.has(id)) {
      skippedCount++;
      continue;
    }

    if (!preset.baseVals || Object.keys(preset.baseVals).length === 0) {
      skippedCount++;
      continue;
    }

    const author = extractAuthor(title);

    const milkContent = presetToMilkContent(preset);
    const milkFilename = `${id}.milk`;
    const milkPath = path.join(OUTPUT_DIR, milkFilename);
    const filePathRelative = `/milkdrop-presets/butterchurn/${milkFilename}`;

    const version = getPresetVersion(preset.baseVals);
    const fidelityClass = version >= 2 ? 'near-exact' : 'partial';

    fs.writeFileSync(milkPath, milkContent, 'utf-8');

    const entry = {
      id,
      title,
      author,
      order: nextOrder + newEntries.length,
      file: filePathRelative,
      preview: true,
      tags: ['collection:butterchurn', 'preset'],
      expectedFidelityClass: fidelityClass,
      visualEvidenceTier: 'runtime',
      supports: {
        webgl: true,
        webgpu: true,
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass,
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: [
          'Imported from butterchurn-presets corpus. Requires visual reference capture.',
        ],
      },
    };

    newEntries.push(entry);
    importedCount++;
  }

  // Update catalog.json
  if (newEntries.length > 0) {
    const existingRaw = fs.existsSync(CATALOG_PATH)
      ? fs.readFileSync(CATALOG_PATH, 'utf-8')
      : '{}';

    const catalog = JSON.parse(existingRaw);
    catalog.version ??= 2;
    catalog.generatedAt ??= new Date().toISOString().slice(0, 10);
    catalog.presets ??= [];
    catalog.presets.push(...newEntries);

    fs.writeFileSync(
      CATALOG_PATH,
      `${JSON.stringify(catalog, null, 2)}\n`,
      'utf-8',
    );
  }

  console.log(
    `\nImported ${importedCount} presets (${skippedCount} skipped, ${newEntries.length} new to catalog)`,
  );
  console.log(`  .milk files → ${OUTPUT_DIR}`);
  console.log(`  catalog     → ${CATALOG_PATH}`);
}

await main();
