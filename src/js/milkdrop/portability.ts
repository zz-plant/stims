/**
 * What about a preset will not carry over when it leaves Stims.
 *
 * Stims reads everything MilkDrop 2 does and more: extra EEL functions
 * (`clamp`, `mod`, `smoothstep`), extra audio and input signals (`beat_pulse`,
 * `rms`, `input_x`), extra settings (`mesh_density`), extra built-in
 * textures (`voronoi`, `caustics`), and GLSL-flavoured shader code. A preset
 * that leans on any of these renders here and breaks — or quietly differs —
 * everywhere else, and nothing told the author.
 *
 * Every check is against MilkDrop 2's own sets, which are known precisely:
 * its EEL function table, its preset variables, the `[preset00]` fields its
 * exporter writes (`milkdrop2-export.ts`) and its built-in textures. The
 * function set is confirmed by the corpus: across the ~1,000 MilkDrop 2 and
 * projectM presets bundled here, no equation calls a function outside it.
 * projectM and Butterchurn read the same format and follow the same sets;
 * where they differ from MilkDrop 2 is not checked here, and the UI says so.
 */
import { milkdropVariableNames } from './builtin-docs.ts';
import { DEFAULT_MILKDROP_STATE } from './compiler/default-state.ts';
import { findMilkdropFieldLine } from './formatter.ts';
import { MILKDROP2_STIMS_KEYS } from './milkdrop2-export.ts';
import type { MilkdropCompiledPreset } from './types.ts';

export type PortabilitySeverity = 'breaks' | 'differs' | 'needs';

export type PortabilityItem = {
  severity: PortabilitySeverity;
  title: string;
  detail: string;
  /** 1-based line in the buffer, or null. */
  line: number | null;
};

/** ns-eel2 as MilkDrop 2 ships it. */
const MILKDROP2_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sqr',
  'sqrt',
  'pow',
  'exp',
  'log',
  'log10',
  'abs',
  'min',
  'max',
  'sign',
  'rand',
  'floor',
  'ceil',
  'int',
  'invsqrt',
  'sigmoid',
  'band',
  'bor',
  'bnot',
  'if',
  'equal',
  'above',
  'below',
  'megabuf',
  'gmegabuf',
  'loop',
  'while',
  'exec2',
  'exec3',
  'memcpy',
  'memset',
  'freembuf',
  'assign',
]);

/** How to write each Stims-only function in plain MilkDrop 2 EEL. */
const FUNCTION_REWRITES: Record<string, string> = {
  mod: 'a % b',
  fmod: 'a % b',
  clamp: 'min(max(x, lo), hi)',
  mix: 'a + (b - a)*t',
  lerp: 'a + (b - a)*t',
  step: 'bnot(below(x, edge))',
  smoothstep: 't = min(max((x - lo)/(hi - lo), 0), 1); t*t*(3 - 2*t)',
  frac: 'x - floor(x)',
  randint: 'rand(n) (MilkDrop 2’s rand already returns an integer)',
};

/** The variables MilkDrop 2 itself feeds a preset. */
const MILKDROP2_SIGNALS = new Set([
  'time',
  'fps',
  'frame',
  'progress',
  'bass',
  'mid',
  'treb',
  'bass_att',
  'mid_att',
  'treb_att',
]);

/**
 * Textures MilkDrop 2 provides itself; any other `sampler_<name>` is loaded
 * from a file in the player's textures folder.
 */
const MILKDROP2_TEXTURES = new Set([
  'main',
  'noise_lq',
  'noise_lq_lite',
  'noise_mq',
  'noise_hq',
  'noisevol_lq',
  'noisevol_hq',
  'blur1',
  'blur2',
  'blur3',
]);

/** Tokens that only exist in GLSL; MilkDrop 2 compiles shaders as HLSL. */
const GLSL_ONLY = [
  { pattern: /\bvec[234]\b/u, hlsl: 'float2/float3/float4' },
  { pattern: /\bmat[234]\b/u, hlsl: 'float2x2/float3x3/float4x4' },
  { pattern: /\btexture2D\s*\(/u, hlsl: 'tex2D' },
  { pattern: /\bfract\s*\(/u, hlsl: 'frac' },
  { pattern: /\bmix\s*\(/u, hlsl: 'lerp' },
  { pattern: /\bmod\s*\(/u, hlsl: 'fmod' },
] as const;

const PROGRAM_KEY =
  /^(?:per_frame_init_|per_frame_|per_pixel_|init_|wave_\d+_(?:init|per_frame|per_point)_?|shape_\d+_(?:init|per_frame)_?)\d+$/iu;

function stripComment(line: string): string {
  const cut = line.indexOf('//');
  return cut < 0 ? line : line.slice(0, cut);
}

function firstLineMatching(source: string, test: (line: string) => boolean) {
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    if (test(stripComment(lines[i] ?? ''))) return i + 1;
  }
  return null;
}

/** A buffer line that holds equation code (`per_frame_3=…`, `[per_frame]` body aside). */
const EQUATION_LINE =
  /^\s*(?:per_frame_init_|per_frame_|per_pixel_|init_|wave_\d+_(?:init|per_frame|per_point)|shape_\d+_(?:init|per_frame))_?\d+\s*=/iu;

const wordPattern = (name: string) =>
  new RegExp(`(?<![\\w.])${name}(?![\\w])`, 'u');

export function checkPortability(
  compiled: MilkdropCompiledPreset,
  source: string,
): PortabilityItem[] {
  const items: PortabilityItem[] = [];
  const equations = compiled.ast.fields
    .filter((field) => PROGRAM_KEY.test(field.key.trim()))
    .map((field) => field.rawValue)
    .join('\n');

  // Functions: every call name in the equations.
  const called = new Set(
    [...equations.matchAll(/(?<![\w.])([a-z_]\w*)\s*\(/giu)].map((match) =>
      (match[1] as string).toLowerCase(),
    ),
  );
  for (const name of [...called].sort()) {
    const rewrite = FUNCTION_REWRITES[name];
    if (!rewrite || MILKDROP2_FUNCTIONS.has(name)) continue;
    items.push({
      severity: 'breaks',
      title: `\`${name}()\` is a Stims extension`,
      detail: `MilkDrop 2 has no ${name}(), so it fails to compile these equations. Write it as ${rewrite}.`,
      line: firstLineMatching(
        source,
        (line) =>
          EQUATION_LINE.test(line) &&
          new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'iu').test(
            line.slice(line.indexOf('=') + 1),
          ),
      ),
    });
  }

  // Signals Stims feeds that the preset reads but never sets itself.
  const assigned = new Set(
    [...equations.matchAll(/(?<![\w.])([a-z_]\w*)\s*=(?!=)/giu)].map((match) =>
      (match[1] as string).toLowerCase(),
    ),
  );
  for (const name of milkdropVariableNames('signal')) {
    if (MILKDROP2_SIGNALS.has(name) || assigned.has(name)) continue;
    if (!wordPattern(name).test(equations)) continue;
    items.push({
      severity: 'differs',
      title: `\`${name}\` only exists in Stims`,
      detail: `MilkDrop 2 does not feed ${name}, so it reads as 0 there and whatever it drives stays still.`,
      line: firstLineMatching(
        source,
        (line) =>
          EQUATION_LINE.test(line) &&
          wordPattern(name).test(line.slice(line.indexOf('=') + 1)),
      ),
    });
  }

  // Settings MilkDrop 2 has no field for, where they change something.
  const values = compiled.ir.numericFields;
  for (const key of Object.keys(values).sort()) {
    if (
      MILKDROP2_STIMS_KEYS.has(key) ||
      key.startsWith('shape_') ||
      key.startsWith('custom_wave_') ||
      values[key] === DEFAULT_MILKDROP_STATE[key]
    ) {
      continue;
    }
    items.push({
      severity: 'differs',
      title: `\`${key}\` is a Stims setting`,
      detail:
        'Export keeps it, but MilkDrop 2 has no such field and ignores it, so the preset looks different there.',
      line: findMilkdropFieldLine(source, key),
    });
  }

  // Textures, and GLSL where MilkDrop 2 expects HLSL.
  const shaders = [
    compiled.ir.shaderSource?.warp ?? compiled.ir.shaderText.warp ?? '',
    compiled.ir.shaderSource?.comp ?? compiled.ir.shaderText.comp ?? '',
  ].join('\n');
  const textures = new Set(
    [...shaders.matchAll(/\bsampler_([a-z0-9_]+)/giu)].map((match) =>
      (match[1] as string).toLowerCase().replace(/^(?:fc|fw|pc|pw)_/u, ''),
    ),
  );
  for (const name of [...textures].sort()) {
    if (MILKDROP2_TEXTURES.has(name) || /^rand\d\d/u.test(name)) continue;
    items.push({
      severity: 'needs',
      title: `Needs the texture \`${name}\``,
      detail: `MilkDrop 2 loads ${name} from an image file in the player's textures folder; without it the sampler reads black. Ship the file with the preset.`,
      line: firstLineMatching(source, (line) =>
        new RegExp(`sampler_(?:(?:fc|fw|pc|pw)_)?${name}\\b`, 'iu').test(line),
      ),
    });
  }
  for (const { pattern, hlsl } of GLSL_ONLY) {
    if (!pattern.test(shaders)) continue;
    const token = shaders.match(pattern)?.[0].replace(/\s*\($/u, '') ?? '';
    items.push({
      severity: 'breaks',
      title: `\`${token}\` is GLSL`,
      detail: `MilkDrop 2 compiles shaders as HLSL and rejects ${token}; use ${hlsl}.`,
      line: firstLineMatching(source, (line) => pattern.test(line)),
    });
  }

  const order: Record<PortabilitySeverity, number> = {
    breaks: 0,
    differs: 1,
    needs: 2,
  };
  return items.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  );
}
