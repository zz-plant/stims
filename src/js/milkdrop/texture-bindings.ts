/**
 * Static texture-binding analysis for the editor's Textures pane: every
 * `sampler_*` reference in a preset's warp/comp shader blocks, resolved to
 * the bundled texture file — or internal render target — the engine will
 * actually bind.
 *
 * This mirrors the apply-time pipeline rather than offering a second
 * opinion about it. The built-in rewrites in
 * `compiler/shader-analysis.ts` (`normalizeHlslToGlsl`) turn
 * `sampler_main`/`fw_main`, `pw/pc_main`, `fc_main`, `blur1-3`, the noise
 * family and the noisevol family into internal uniforms, and every
 * `sampler_*` that survives is resolved by `compiler/custom-samplers.ts`'s
 * fallback table — the same resolution both feedback managers make when they
 * bind textures (feedback-manager-shared.ts `applyAssembledDirectShaders`,
 * feedback-manager-webgpu-composite.ts `bindCustomMilkdropSamplerTexture`),
 * so both backends bind the same files for the external rows. The backends
 * differ only in how volume samples read those files: WebGL slices a bundled
 * 2D atlas, WebGPU reads native 3D volumes. Those rows carry `volume: true`
 * so the pane can say which is which.
 *
 * Deliberately not listed: the shader-control texture layer and warp texture
 * (`texture_source` / `warp_texture_source` statements — no bundled preset
 * sets them), and custom waves/shapes, which carry EEL equations only — the
 * format gives them no shader blocks, so they cannot sample textures.
 */

import {
  resolveCustomSamplerSampleMode,
  resolveCustomSamplerTextureFile,
  resolveFallbackSamplerTextureFile,
} from './compiler/custom-samplers.ts';
import type { MilkdropPresetIR } from './compiler-types.ts';
import { normalizeMilkdropShaderSamplerName } from './shader-samplers.ts';
import { MILKDROP_TEXTURE_FILES } from './texture-files';

export type MilkdropTextureBinding = {
  /** The sampler exactly as the preset spells it, e.g. `sampler_fw_clouds`. */
  name: string;
  /** Canonical name after the shared alias table, when one matched. */
  canonical: string | null;
  /** Bundled texture file the engine binds; null for render targets and
   * generated noise, which have no file to preview. */
  textureFile: string | null;
  /** What the sampler reads when there is no file. */
  target: string | null;
  /** Sample mode the engine derives from MilkDrop's f/p + w/c prefixes. */
  filter: 'linear' | 'nearest' | null;
  wrap: 'repeat' | 'clamp' | null;
  /** The sampler is read as a 3D volume, where the two backends differ. */
  volume: boolean;
  /** The name matched no bundled texture; the engine bound its
   * deterministic stand-in instead. */
  substitute: boolean;
  /** The name only resolves through the alias table (`fw_clouds` →
   * `perlin`). */
  aliased: boolean;
  /** MilkDrop `randNN` samplers re-pick from the bundled pool at every
   * preset load. */
  random: boolean;
};

export type MilkdropTextureBindings = {
  /** Samplers that resolve to a bundled texture file through the
   * texture-pack table — the pane's headline content. */
  external: MilkdropTextureBinding[];
  /** Frame buffers, blur passes and the noise textures the engine binds
   * without the texture-pack table. */
  internal: MilkdropTextureBinding[];
};

/** Mirrors `REFERENCE_PATTERN` in `compiler/custom-samplers.ts`, which the
 * feedback managers run over the assembled GLSL at apply time; scanning the
 * raw block text here keeps the pane's answer identical to the engine's. */
const SAMPLER_REFERENCE_PATTERN = /\bsampler_[A-Za-z_][A-Za-z0-9_]*\b/gu;

/** Volume reads the engine routes to the 3D path: `tex3D`/`texture3D`
 * calls, plus `texture(` calls on the noisevol family — the same call
 * shapes `normalizeHlslToGlsl` special-cases into `sampleNoiseVolume`. */
const EXPLICIT_VOLUME_SAMPLE_PATTERN =
  /\b(?:texture3D|tex3D)\s*\(\s*(sampler_[A-Za-z_][A-Za-z0-9_]*)\s*,/giu;
const NOISEVOL_TEXTURE_SAMPLE_PATTERN =
  /\btexture\s*\(\s*(sampler_(?:fw_|pw_)?noisevol(?:_lq|_mq|_hq)?)\s*,/giu;

/** Mirrors `RAND_TEXTURE_PATTERN` in `compiler/custom-samplers.ts`, minus
 * the flag groups this scan has no use for. */
const RAND_SAMPLER_PATTERN = /^rand\d{2}(?:_smalltiled)?$/u;

function stripSamplerPrefix(name: string): string {
  return name.replace(/^sampler_/u, '');
}

/** Built-in sampler shapes, mirroring the rewrite regexes
 * `normalizeHlslToGlsl` runs — the names the engine turns into internal
 * uniforms before any texture-pack binding happens. Shape, not the alias
 * table: `rand00` aliases to `noise` in the table, but the rewrite only
 * matches the literal noise shapes, so the engine still binds `rand00`
 * from the texture-pack pool and so must this scan. */
const MAIN_SAMPLER_PATTERN = /^sampler_(?:fw_)?main$/u;
const PREVIOUS_FRAME_SAMPLER_PATTERN = /^sampler_(?:pw_|pc_)main$/u;
const WARP_OUTPUT_SAMPLER_PATTERN = /^sampler_fc_main$/u;
const BLUR_SAMPLER_PATTERN = /^sampler_blur([123])$/u;
const NOISE_SAMPLER_PATTERN = /^sampler_(?:fw_|pw_)?noise(?:_lq|_mq|_hq)?$/u;
const NOISEVOL_SAMPLER_PATTERN =
  /^sampler_(?:fw_|pw_)?noisevol(?:_lq|_mq|_hq)?$/u;

function classifyInternalSampler(
  name: string,
): Pick<MilkdropTextureBinding, 'textureFile' | 'target' | 'volume'> | null {
  const lower = name.toLowerCase();
  if (NOISEVOL_SAMPLER_PATTERN.test(lower)) {
    // WebGL samples the volume by slicing the bundled simplex atlas
    // (`sampleNoiseVolume`); WebGPU reads a generated native 3D volume.
    // The atlas PNG is the one honest preview both paths share.
    return {
      textureFile: MILKDROP_TEXTURE_FILES.simplex,
      target: 'the 3D noise volume',
      volume: true,
    };
  }
  if (NOISE_SAMPLER_PATTERN.test(lower)) {
    // The rewrite sends the whole family to `noiseTex`, which the manager
    // binds to the bundled noise PNG.
    return {
      textureFile: MILKDROP_TEXTURE_FILES.noise,
      target: 'the bundled noise texture',
      volume: false,
    };
  }
  if (MAIN_SAMPLER_PATTERN.test(lower)) {
    return { textureFile: null, target: 'the current frame', volume: false };
  }
  if (PREVIOUS_FRAME_SAMPLER_PATTERN.test(lower)) {
    return { textureFile: null, target: 'the previous frame', volume: false };
  }
  if (WARP_OUTPUT_SAMPLER_PATTERN.test(lower)) {
    return { textureFile: null, target: 'the warp output', volume: false };
  }
  const blurMatch = lower.match(BLUR_SAMPLER_PATTERN);
  if (blurMatch) {
    return {
      textureFile: null,
      target: `blur pass ${blurMatch[1]}`,
      volume: false,
    };
  }
  return null;
}

export function collectMilkdropTextureBindings(
  ir: MilkdropPresetIR,
): MilkdropTextureBindings {
  const names: string[] = [];
  const volumeSampledNames = new Set<string>();
  for (const block of [ir.shaderText.warp, ir.shaderText.comp]) {
    if (!block) continue;
    for (const pattern of [
      EXPLICIT_VOLUME_SAMPLE_PATTERN,
      NOISEVOL_TEXTURE_SAMPLE_PATTERN,
    ]) {
      for (const match of block.matchAll(pattern)) {
        const sampled = match[1];
        if (sampled) volumeSampledNames.add(sampled.toLowerCase());
      }
    }
    for (const match of block.matchAll(SAMPLER_REFERENCE_PATTERN)) {
      if (!names.includes(match[0])) names.push(match[0]);
    }
  }

  const external: MilkdropTextureBinding[] = [];
  const internal: MilkdropTextureBinding[] = [];
  for (const name of names) {
    const canonical = normalizeMilkdropShaderSamplerName(name);
    const aliased =
      canonical !== null &&
      canonical !== stripSamplerPrefix(name).toLowerCase();
    const builtIn = classifyInternalSampler(name);
    if (builtIn) {
      internal.push({
        name,
        canonical,
        filter: null,
        wrap: null,
        substitute: false,
        random: false,
        aliased,
        ...builtIn,
      });
      continue;
    }
    // Everything else is a texture-pack sampler: the same fallback the
    // engine's apply path runs, so the file shown is the file bound.
    const textureFile = resolveFallbackSamplerTextureFile(name);
    const { filter, wrap } = resolveCustomSamplerSampleMode(name);
    external.push({
      name,
      canonical,
      textureFile,
      target: null,
      filter,
      wrap,
      volume: volumeSampledNames.has(name.toLowerCase()),
      substitute: resolveCustomSamplerTextureFile(name) === null,
      aliased,
      random: RAND_SAMPLER_PATTERN.test(stripSamplerPrefix(name).toLowerCase()),
    });
  }
  return { external, internal };
}
