import fs from 'node:fs';
import path from 'node:path';
import {
  type ButterchurnPresetEquations,
  transpileButterchurnPreset,
} from './butterchurn-eel-transpiler.ts';

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
  init_eqs_str?: string;
  frame_eqs_str?: string;
};

type PresetWave = {
  baseVals: Record<string, number>;
  init_eqs_str?: string;
  frame_eqs_str?: string;
  point_eqs_str?: string;
};

type ButterchurnPreset = {
  version: number;
  baseVals: Record<string, number>;
  shapes: PresetShape[];
  waves: PresetWave[];
  init_eqs_str?: string;
  frame_eqs_str?: string;
  pixel_eqs_str?: string;
  warp?: string;
  comp?: string;
};

/**
 * `wavecode_N_*` and `shapecode_N_*` entries keep MilkDrop's unprefixed field
 * names (`enabled`, `sides`, `num_inst`), unlike the Hungarian-notation keys
 * used by the top-level preset section.
 */
function serializePrefixedBaseVals(
  baseVals: Record<string, number>,
  prefix: string,
): string[] {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(baseVals)) {
    lines.push(`${prefix}${key}=${formatNumber(val)}`);
  }
  return lines;
}

function serializeEquations(prefix: string, statements: string[]): string[] {
  return statements.map(
    (statement, index) => `${prefix}${index + 1}=${statement}`,
  );
}

function presetToMilkContent(preset: ButterchurnPreset): {
  content: string;
  equations: ButterchurnPresetEquations;
} {
  const equations = transpileButterchurnPreset(preset);
  const parts: string[] = [];

  // MilkDrop stores everything in one `[preset00]` section: base values,
  // per-wave and per-shape code blocks, then the equation programs.
  parts.push('[preset00]');
  parts.push(serializeBaseVals(preset.baseVals, MILKDROP_FIELD_MAP));

  for (let i = 0; i < preset.waves.length; i++) {
    const wave = preset.waves[i];
    if (!wave) continue;
    parts.push(...serializePrefixedBaseVals(wave.baseVals, `wavecode_${i}_`));
  }

  for (let i = 0; i < preset.shapes.length; i++) {
    const shape = preset.shapes[i];
    if (!shape) continue;
    parts.push(...serializePrefixedBaseVals(shape.baseVals, `shapecode_${i}_`));
  }

  parts.push(...serializeEquations('per_frame_init_', equations.init));
  parts.push(...serializeEquations('per_frame_', equations.perFrame));
  parts.push(...serializeEquations('per_pixel_', equations.perPixel));

  for (const wave of equations.waves) {
    parts.push(...serializeEquations(`wave_${wave.index}_init`, wave.init));
    parts.push(
      ...serializeEquations(`wave_${wave.index}_per_frame`, wave.perFrame),
    );
    parts.push(
      ...serializeEquations(`wave_${wave.index}_per_point`, wave.perPoint),
    );
  }

  for (const shape of equations.shapes) {
    parts.push(...serializeEquations(`shape_${shape.index}_init`, shape.init));
    parts.push(
      ...serializeEquations(`shape_${shape.index}_per_frame`, shape.perFrame),
    );
  }

  parts.push('');

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

  return { content: `${parts.join('\n').trim()}\n`, equations };
}

type IdAssignment =
  | { kind: 'import'; id: string }
  | { kind: 'duplicate-of'; id: string };

/**
 * The corpus ships several presets whose filenames differ only in characters
 * `slugify` collapses (`_Geiss - …` vs `Geiss - …`, `A & B - …` vs `A + B - …`),
 * so the naive slug collides. Assign ids up front, over the whole sorted file
 * list, so the result does not depend on which files happen to be new:
 *
 * - first filename (ASCII sort) for a slug keeps the bare slug;
 * - a later filename with byte-identical content is a true duplicate and is not
 *   imported at all;
 * - a later filename with different content is a genuinely distinct preset and
 *   gets a `-alt`/`-alt-2`/… suffix.
 */
function assignPresetIds(
  files: string[],
  readFile: (file: string) => string,
): Map<string, IdAssignment> {
  const assignments = new Map<string, IdAssignment>();
  const bySlug = new Map<string, { id: string; content: string }[]>();

  for (const file of files) {
    const title = file.replace(/\.json$/, '');
    const slug = slugify(title);
    const claimed = bySlug.get(slug) ?? [];
    const content = readFile(file);

    const identical = claimed.find((claim) => claim.content === content);
    if (identical) {
      assignments.set(file, { kind: 'duplicate-of', id: identical.id });
      continue;
    }

    const id =
      claimed.length === 0
        ? slug
        : claimed.length === 1
          ? `${slug}-alt`
          : `${slug}-alt-${claimed.length}`;
    claimed.push({ id, content });
    bySlug.set(slug, claimed);
    assignments.set(file, { kind: 'import', id });
  }

  return assignments;
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

  // `--rewrite` regenerates `.milk` files for presets already in the catalog.
  // Needed whenever the emitted format changes, since the default import path
  // skips ids it has already seen.
  const rewriteExisting = process.argv.includes('--rewrite');

  const fileContents = new Map<string, string>();
  const readPresetFile = (file: string): string => {
    const cached = fileContents.get(file);
    if (cached !== undefined) return cached;
    const raw = fs.readFileSync(path.join(PRESETS_DIR, file), 'utf-8');
    fileContents.set(file, raw);
    return raw;
  };
  const idAssignments = assignPresetIds(files, readPresetFile);

  let importedCount = 0;
  let skippedCount = 0;
  let duplicateCount = 0;
  let rewrittenCount = 0;
  let equationStatements = 0;
  const unsupportedBlocks: { preset: string; scope: string; reason: string }[] =
    [];

  // Determine next order number
  const existingIds = new Set(Object.keys(existingCatalog.presets));
  let nextOrder = 1;
  for (const entry of Object.entries(existingCatalog.presets)) {
    if ((entry[1] as number) + 1 > nextOrder) {
      nextOrder = (entry[1] as number) + 1;
    }
  }

  for (const file of files) {
    const assignment = idAssignments.get(file);
    if (!assignment) continue;
    if (assignment.kind === 'duplicate-of') {
      duplicateCount++;
      continue;
    }

    const raw = readPresetFile(file);

    let preset: ButterchurnPreset;
    try {
      preset = JSON.parse(raw);
    } catch (e) {
      console.error(`  Failed to parse ${file}: ${e}`);
      continue;
    }

    const title = file.replace(/\.json$/, '');
    const id = assignment.id;
    const alreadyImported = existingIds.has(id);

    if (alreadyImported && !rewriteExisting) {
      skippedCount++;
      continue;
    }

    if (!preset.baseVals || Object.keys(preset.baseVals).length === 0) {
      skippedCount++;
      continue;
    }

    const author = extractAuthor(title);

    const { content: milkContent, equations } = presetToMilkContent(preset);
    const milkFilename = `${id}.milk`;
    const milkPath = path.join(OUTPUT_DIR, milkFilename);
    const filePathRelative = `/milkdrop-presets/butterchurn/${milkFilename}`;

    const version = getPresetVersion(preset.baseVals);
    const fidelityClass = version >= 2 ? 'near-exact' : 'partial';

    fs.writeFileSync(milkPath, milkContent, 'utf-8');

    equationStatements +=
      equations.init.length +
      equations.perFrame.length +
      equations.perPixel.length +
      equations.waves.reduce(
        (total, wave) =>
          total +
          wave.init.length +
          wave.perFrame.length +
          wave.perPoint.length,
        0,
      ) +
      equations.shapes.reduce(
        (total, shape) => total + shape.init.length + shape.perFrame.length,
        0,
      );
    for (const entry of equations.unsupported) {
      unsupportedBlocks.push({ preset: id, ...entry });
    }

    if (alreadyImported) {
      rewrittenCount++;
      continue;
    }

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
    `\nImported ${importedCount} presets (${rewrittenCount} rewritten, ${skippedCount} skipped, ${duplicateCount} byte-identical duplicates, ${newEntries.length} new to catalog)`,
  );
  console.log(`  equations   → ${equationStatements} EEL statements emitted`);
  if (unsupportedBlocks.length > 0) {
    const presetsAffected = new Set(
      unsupportedBlocks.map((entry) => entry.preset),
    );
    console.log(
      `  untranslated→ ${unsupportedBlocks.length} equation blocks across ${presetsAffected.size} presets`,
    );
    const reasons = new Map<string, number>();
    for (const entry of unsupportedBlocks) {
      reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
    }
    for (const [reason, count] of [...reasons.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`      ${count}x ${reason}`);
    }
  }
  console.log(`  .milk files → ${OUTPUT_DIR}`);
  console.log(`  catalog     → ${CATALOG_PATH}`);
}

await main();
