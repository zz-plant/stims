/**
 * Recognises what a preset's shader source is trying to do, so it can be re-expressed.
 *
 * Preset shaders cannot be handed to the GPU as written: they are
 * HLSL-flavored, target a fixed-function pipeline that no longer exists, and
 * must run on two backends whose shading languages differ. This module reads
 * the parsed shader AST and extracts a structured description — samplers, UV
 * transforms, tint and blend modes, the scalar controls a preset animates —
 * that `shader-analysis-glsl.ts` and the WebGPU TSL path can each realise in
 * their own language.
 *
 * That is why so much of this file is pattern recognition with names like
 * `isShaderSolarizeSampleExpression`. Each predicate exists because real
 * presets write that exact shape and the original renderer produced a
 * particular result. There is no specification to consult; the corpus is the
 * specification.
 *
 * Consequences worth knowing before editing:
 * - Unrecognised constructs degrade, they do not throw. A preset that renders
 *   imperfectly beats one that refuses to load.
 * - A "simplification" that collapses two predicates usually breaks a preset
 *   nobody in the review has heard of. Run `bun run lab:glsl-corpus-scan` and
 *   `bun run parity:suite`; the corpus is the only witness that matters.
 */
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../shader-ast';
import type {
  MilkdropExpressionNode,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
  MilkdropShaderStatement,
} from '../types';
import { DEFAULT_MILKDROP_STATE } from './default-state';
import {
  isUnsupportedParsedShaderStatement,
  shouldEmitDirectProgramStatement,
  shouldPreferDirectProgramExecution,
  shouldRetainDirectProgramContextStatement,
} from './shader-analysis-direct-program';
import { mergeShaderControlAnalysis } from './shader-analysis-evaluation';
import {
  analyzeShaderUvTransform,
  applyMainUvTransformControls,
  applyShaderControlValue,
  applyShaderExpressionOperator,
  applyTextureLayerSample,
  buildMilkdropSignalNameReplacements,
  buildTintBlendExpression,
  createDefaultShaderControlExpressions,
  createDefaultShaderControls,
  createLiteralExpression,
  evaluateShaderScalarResult,
  evaluateShaderVectorResult,
  extractScaledShaderSampleExpression,
  extractShaderInvertedSampleExpression,
  getShaderSampleInfo,
  hasUnsupportedVolumeSample,
  isAuxShaderSamplerName,
  isIdentityTextureSampleExpression,
  isKnownShaderScalarKey,
  isShaderMainSampleExpression,
  isShaderSampleRgbExpression,
  isShaderScalarValue,
  isShaderSolarizeSampleExpression,
  isShaderUvIdentifier,
  MILKDROP_RAND_FRAME_GLSL,
  MILKDROP_TEXSIZE_MAIN_GLSL,
  MILKDROP_TEXSIZE_NOISE_GLSL,
  MILKDROP_TEXSIZE_SUBSTITUTE_GLSL,
  normalizeShaderSamplerName,
  normalizeShaderSyntax,
  normalizeShaderTextureBlendMode,
  parseShaderSampleMixPattern,
  parseShaderSamplerSource,
  parseShaderScalar,
  parseShaderTextureBlendMode,
  parseShaderTintList,
  parseShaderVec2Constructor,
  parseShaderVec2List,
  parseShaderVec3Constructor,
  resolveShaderExpressionIdentifiers,
  type ShaderExpressionEnv,
  type ShaderRuntimeEnv,
} from './shader-analysis-helpers';
import { desugarShaderBranches } from './shader-branch-desugar';
import {
  applyShaderHeuristicControlStatement,
  applyShaderScalarAliasControl,
} from './shader-control-application';

export { buildShaderProgramPayload } from './shader-analysis-direct-program';
export {
  evaluateMilkdropShaderControlExpressions,
  mergeShaderControlAnalysis,
} from './shader-analysis-evaluation';
export { buildUnsupportedVolumeSamplerWarnings } from './shader-analysis-helpers';

export function normalizeHlslToGlsl(shaderText: string): string {
  const result = shaderText
    // Volume-noise samples take a vec3 coordinate; route them to the
    // sampleNoiseVolume helper (atlas-sliced 3D emulation) instead of
    // texture2D, which has no vec3 overload. Must run before the generic
    // texture( → texture2D( rewrite below.
    .replace(
      /\b(?:texture3D|texture|tex3D)\s*\(\s*sampler_(?:fw_|pw_)?noisevol(?:_lq|_mq|_hq)?\s*,/giu,
      'sampleNoiseVolume(',
    )
    .replace(/\btexture\s*\(/giu, 'texture2D(')
    .replace(/\buint\s*\(([^)]+)\)/giu, 'int($1)')
    .replace(/\b(\d+)u\b/giu, '$1')
    .replace(/\bfloat2\b/giu, 'vec2')
    .replace(/\bfloat3\b/giu, 'vec3')
    .replace(/\bfloat4\b/giu, 'vec4')
    .replace(/\bsampler_main\b/giu, 'currentTex')
    .replace(/\bsampler_fw_main\b/giu, 'currentTex')
    .replace(/\bsampler_pc_main\b/giu, 'previousTex')
    .replace(/\bsampler_pw_main\b/giu, 'previousTex')
    .replace(/\bsampler_fc_main\b/giu, 'warpTex')
    .replace(/\bsampler_blur1\b/giu, 'blur1Tex')
    .replace(/\bsampler_blur2\b/giu, 'blur2Tex')
    .replace(/\bsampler_blur3\b/giu, 'blur3Tex')
    .replace(/\bsampler_(?:fw_|pw_)?noise(?:_lq|_mq|_hq)?\b/giu, 'noiseTex')
    .replace(
      /\bsampler_(?:fw_|pw_)?noisevol(?:_lq|_mq|_hq)?\b/giu,
      'simplexTex',
    )
    .replace(
      /\btexsize_(?:fw_|pw_)?noise(?:_lq|_mq|_hq)?\b|\btexsize_(?:fw_|pw_)?noisevol(?:_lq|_mq|_hq)?\b/giu,
      MILKDROP_TEXSIZE_NOISE_GLSL,
    )
    .replace(
      /\btexsize_main\b|\btexsize_fw_main\b|\btexsize_pw_main\b|\btexsize_pc_main\b|\btexsize_fc_main\b|\btexsize_blur1\b|\btexsize_blur2\b|\btexsize_blur3\b/giu,
      MILKDROP_TEXSIZE_MAIN_GLSL,
    )
    // Custom-texture sizes (texsize_mcode1, texsize_cells, …) have no
    // uniform behind them — MilkDrop injects them at runtime, this pipeline
    // does not — so any identifier left after the specific rewrites above
    // would reach the GLSL undeclared and fail to compile. Every bundled
    // substitute texture is 640x640 (xy = size, zw = 1/size).
    .replace(/\btexsize_[A-Za-z0-9_]+\b/giu, MILKDROP_TEXSIZE_SUBSTITUTE_GLSL)
    .replace(/\btexsize\b/giu, MILKDROP_TEXSIZE_MAIN_GLSL)
    .replace(/\buv_orig\b/giu, 'vUv')
    .replace(/\bhue_shader\b/giu, 'vec3(colorScale * tint)')
    .replace(/\bhue_secondary\b/giu, 'vec3(tint)')
    .replace(/\bhue_tertiary\b/giu, 'vec3(colorScale)')
    .replace(/\brand_frame\b/giu, MILKDROP_RAND_FRAME_GLSL);
  // Signal aliases are rewritten through the shared table
  // (MILKDROP_SIGNAL_NAME_ALIASES) so this chain and the composite emitter
  // cannot drift. `\b` word boundaries keep `bass` from matching inside
  // `bass_att`; longest-first ordering keeps the more specific alias winning.
  return buildMilkdropSignalNameReplacements(result);
}

// Slices the body of a `shader_body { … }` block by scanning to the closing
// brace that matches the block's opening brace, counting nested braces so
// if/for blocks stay intact. Content after the closing brace (trailing
// statements, comments, a second shader_body block) belongs to the preset
// text outside the body and must never be folded into the executable GLSL.
function extractShaderBodyBlock(
  shaderText: string,
  openBrace: number,
): string | null {
  let depth = 1;
  let inLineComment = false;
  for (let index = openBrace + 1; index < shaderText.length; index += 1) {
    const char = shaderText[index];
    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      }
      continue;
    }
    if (char === '/' && shaderText[index + 1] === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return shaderText.slice(openBrace + 1, index);
      }
    }
  }
  return null;
}

export function extractNativeShaderBody(shaderText: string) {
  const markerMatch = shaderText.match(/\bshader_body\s*\{/iu);
  if (!markerMatch || markerMatch.index === undefined) {
    return null;
  }
  const marker = markerMatch.index;
  const openBrace = marker + markerMatch[0].length - 1;
  const prefix = shaderText.slice(0, marker);
  const declarations = prefix
    .split(/[\r\n;]+/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('uniform '))
    .filter((line) =>
      /^(?:const\s+)?(?:float|int|uint|bool|vec[234]|mat[234]|float[234])\s+[a-z_][a-z0-9_]*(?:\s*=.+)?$/iu.test(
        line,
      ),
    )
    .map((line) => `  ${line};`);
  const rawBody =
    extractShaderBodyBlock(shaderText, openBrace) ??
    shaderText.slice(openBrace + 1);
  const body = normalizeHlslToGlsl(rawBody);

  // Collapse whitespace/empty statements introduced when multiple raw
  // shader chunks are concatenated by the parser.
  const statements = body
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const normalizedBody =
    statements.length > 0 ? `${statements.join(';\n')};` : '';

  if (!normalizedBody) {
    return declarations.length > 0 ? declarations.join('\n') : null;
  }

  return [...declarations, normalizedBody].join('\n');
}

export function splitShaderGlobalsAndBody(glsl: string): {
  globals: string;
  body: string;
} {
  // Matches function declarations by their header: an optional `const`, a
  // scalar/vector/matrix return type, the function name, and the opening
  // paren of the argument list. The argument list is scanned separately (it
  // can contain nested parens, e.g. `vec2 foo(vec2(0.0))`), and a following
  // `{` confirms it is a declaration rather than a stray typed expression.
  const funcHeaderRegex =
    /\b(?:const\s+)?(?:float[234]|vec[234]|mat[234]|double|float|int|uint|bool|void)\s+[a-zA-Z_]\w*\s*\(/gu;
  const ranges: Array<[number, number]> = [];
  let match: RegExpExecArray | null = funcHeaderRegex.exec(glsl);
  while (match !== null) {
    const start = match.index;
    // Walk to the paren that closes this candidate's argument list, counting
    // nested parens so `foo(vec2(a, b))` is consumed as one argument list.
    let parenDepth = 0;
    let parenClose = match.index + match[0].length;
    let closed = false;
    for (; parenClose < glsl.length; parenClose += 1) {
      const char = glsl[parenClose];
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        if (parenDepth === 0) {
          closed = true;
          break;
        }
        parenDepth -= 1;
      }
    }
    if (!closed) {
      match = funcHeaderRegex.exec(glsl);
      continue;
    }
    let brace = parenClose + 1;
    while (brace < glsl.length && /\s/u.test(glsl[brace] ?? '')) {
      brace += 1;
    }
    if (glsl[brace] !== '{') {
      match = funcHeaderRegex.exec(glsl);
      continue;
    }
    let depth = 1;
    let end = brace + 1;
    while (depth > 0 && end < glsl.length) {
      if (glsl[end] === '{') depth++;
      else if (glsl[end] === '}') depth--;
      end++;
    }
    ranges.push([start, end]);
    match = funcHeaderRegex.exec(glsl);
  }
  if (ranges.length === 0) {
    return { globals: '', body: glsl };
  }
  const globals = ranges.map(([s, e]) => glsl.slice(s, e).trim()).join('\n');
  const bodyParts: string[] = [];
  let lastEnd = 0;
  for (const [s, e] of ranges) {
    bodyParts.push(glsl.slice(lastEnd, s));
    lastEnd = e;
  }
  bodyParts.push(glsl.slice(lastEnd));
  const body = bodyParts
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return { globals, body };
}

function applyShaderAstStatement({
  statement,
  controls,
  expressions,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
  hasNativeBody,
}: {
  statement: MilkdropShaderStatement;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
  hasNativeBody: boolean;
}) {
  const key = statement.target.toLowerCase();
  const operator = statement.operator;
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  if (
    hasUnsupportedVolumeSample(resolvedExpression) &&
    !(
      key === 'warp_texture_source' ||
      (hasNativeBody && (key === 'shader_body' || key === 'ret'))
    )
  ) {
    return false;
  }

  const scalarResult = () =>
    evaluateShaderScalarResult(
      resolvedExpression,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );
  const vec2Result = () =>
    evaluateShaderVectorResult(
      resolvedExpression,
      2,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );
  const vec3Result = () =>
    evaluateShaderVectorResult(
      resolvedExpression,
      3,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );

  if (
    (statement.declaration === 'vec2' || statement.declaration === 'vec3') &&
    key !== 'uv' &&
    key !== 'tint' &&
    key !== 'ret' &&
    key !== 'shader_body'
  ) {
    const evaluatedValue = evaluateMilkdropShaderExpression(
      resolvedExpression,
      shaderValueEnv,
      shaderEnv,
    );
    if (!evaluatedValue) {
      return false;
    }
    shaderValueEnv[key] = evaluatedValue;
    shaderExpressionEnv[key] = statement.expression;
    return true;
  }

  if (key === 'texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    if (!source) {
      return false;
    }
    if (source === 'main') {
      controls.textureLayer.source = 'none';
      controls.textureLayer.mode = 'none';
      return true;
    }
    if (!isAuxShaderSamplerName(source)) {
      return false;
    }
    controls.textureLayer.source = source;
    if (controls.textureLayer.mode === 'none') {
      controls.textureLayer.mode = 'mix';
    }
    return true;
  }

  if (key === 'texture_mode') {
    const mode =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderTextureBlendMode(resolvedExpression.name)
        : parseShaderTextureBlendMode(statement.rawValue);
    if (!mode) {
      return false;
    }
    controls.textureLayer.mode = mode;
    return true;
  }

  if (key === 'warp_texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    if (!source || !isAuxShaderSamplerName(source)) {
      return false;
    }
    controls.warpTexture.source = source;
    return true;
  }

  if (key === 'uv') {
    if (operator === '=') {
      const transform = analyzeShaderUvTransform(resolvedExpression);
      if (
        transform &&
        applyMainUvTransformControls({
          transform,
          controls,
          expressions,
          shaderEnv,
        })
      ) {
        shaderValueEnv.uv = {
          kind: 'vec2',
          value: [0, 0],
        };
        shaderExpressionEnv[key] = statement.expression;
        return true;
      }
    }

    const directVec = vec2Result();
    if ((operator === '+=' || operator === '-=') && directVec) {
      const sign = operator === '-=' ? -1 : 1;
      const nextX = applyShaderControlValue(
        '=',
        controls.offsetX,
        expressions.offsetX,
        directVec.values[0] * sign,
        directVec.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        '=',
        controls.offsetY,
        expressions.offsetY,
        directVec.values[1] * sign,
        directVec.expressions[1] ?? null,
      );
      controls.offsetX = nextX.value;
      controls.offsetY = nextY.value;
      expressions.offsetX = nextX.expression;
      expressions.offsetY = nextY.expression;
      shaderEnv.offset_x = nextX.value;
      shaderEnv.offset_y = nextY.value;
      shaderEnv.dx = nextX.value;
      shaderEnv.dy = nextY.value;
      shaderValueEnv.uv = {
        kind: 'vec2',
        value: [nextX.value, nextY.value],
      };
      return true;
    }

    if (
      operator === '=' &&
      resolvedExpression.type === 'binary' &&
      ['+', '-'].includes(resolvedExpression.operator) &&
      isShaderUvIdentifier(resolvedExpression.left)
    ) {
      const offset = evaluateShaderVectorResult(
        resolvedExpression.right,
        2,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (offset) {
        const sign = resolvedExpression.operator === '-' ? -1 : 1;
        const nextX = applyShaderControlValue(
          '=',
          controls.offsetX,
          expressions.offsetX,
          offset.values[0] * sign,
          offset.expressions[0] ?? null,
        );
        const nextY = applyShaderControlValue(
          '=',
          controls.offsetY,
          expressions.offsetY,
          offset.values[1] * sign,
          offset.expressions[1] ?? null,
        );
        controls.offsetX = nextX.value;
        controls.offsetY = nextY.value;
        expressions.offsetX = nextX.expression;
        expressions.offsetY = nextY.expression;
        shaderEnv.offset_x = nextX.value;
        shaderEnv.offset_y = nextY.value;
        shaderEnv.dx = nextX.value;
        shaderEnv.dy = nextY.value;
        shaderValueEnv.uv = {
          kind: 'vec2',
          value: [nextX.value, nextY.value],
        };
        return true;
      }
    }
  }

  if (key === 'tint') {
    const tint = vec3Result();
    if (tint) {
      const nextR = applyShaderControlValue(
        operator,
        controls.tint.r,
        expressions.tint.r,
        tint.values[0],
        tint.expressions[0] ?? null,
      );
      const nextG = applyShaderControlValue(
        operator,
        controls.tint.g,
        expressions.tint.g,
        tint.values[1],
        tint.expressions[1] ?? null,
      );
      const nextB = applyShaderControlValue(
        operator,
        controls.tint.b,
        expressions.tint.b,
        tint.values[2],
        tint.expressions[2] ?? null,
      );
      controls.tint = {
        r: nextR.value,
        g: nextG.value,
        b: nextB.value,
      };
      expressions.tint = {
        r: nextR.expression,
        g: nextG.expression,
        b: nextB.expression,
      };
      shaderEnv.tint_r = nextR.value;
      shaderEnv.tint_g = nextG.value;
      shaderEnv.tint_b = nextB.value;
      return true;
    }
  }

  if (key === 'texture_offset' || key === 'texture_scroll') {
    const offset = vec2Result();
    const scalar = offset ? null : scalarResult();
    if (offset) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetX,
        expressions.textureLayer.offsetX,
        offset.values[0],
        offset.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetY,
        expressions.textureLayer.offsetY,
        offset.values[1],
        offset.expressions[1] ?? null,
      );
      controls.textureLayer.offsetX = nextX.value;
      controls.textureLayer.offsetY = nextY.value;
      expressions.textureLayer.offsetX = nextX.expression;
      expressions.textureLayer.offsetY = nextY.expression;
      return true;
    }
    if (scalar) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetX,
        expressions.textureLayer.offsetX,
        scalar.value,
        scalar.expression,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetY,
        expressions.textureLayer.offsetY,
        scalar.value,
        scalar.expression,
      );
      controls.textureLayer.offsetX = nextX.value;
      controls.textureLayer.offsetY = nextY.value;
      expressions.textureLayer.offsetX = nextX.expression;
      expressions.textureLayer.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'texture_scale') {
    const scale = vec2Result();
    const scalar = scale ? null : scalarResult();
    if (scale) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleX,
        expressions.textureLayer.scaleX,
        scale.values[0],
        scale.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleY,
        expressions.textureLayer.scaleY,
        scale.values[1],
        scale.expressions[1] ?? null,
      );
      controls.textureLayer.scaleX = nextX.value;
      controls.textureLayer.scaleY = nextY.value;
      expressions.textureLayer.scaleX = nextX.expression;
      expressions.textureLayer.scaleY = nextY.expression;
      return true;
    }
    if (scalar) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleX,
        expressions.textureLayer.scaleX,
        scalar.value,
        scalar.expression,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleY,
        expressions.textureLayer.scaleY,
        scalar.value,
        scalar.expression,
      );
      controls.textureLayer.scaleX = nextX.value;
      controls.textureLayer.scaleY = nextY.value;
      expressions.textureLayer.scaleX = nextX.expression;
      expressions.textureLayer.scaleY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_offset' || key === 'warp_texture_scroll') {
    const offset = vec2Result();
    const scalar = offset ? null : scalarResult();
    if (offset) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetX,
        expressions.warpTexture.offsetX,
        offset.values[0],
        offset.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetY,
        expressions.warpTexture.offsetY,
        offset.values[1],
        offset.expressions[1] ?? null,
      );
      controls.warpTexture.offsetX = nextX.value;
      controls.warpTexture.offsetY = nextY.value;
      expressions.warpTexture.offsetX = nextX.expression;
      expressions.warpTexture.offsetY = nextY.expression;
      return true;
    }
    if (scalar) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetX,
        expressions.warpTexture.offsetX,
        scalar.value,
        scalar.expression,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetY,
        expressions.warpTexture.offsetY,
        scalar.value,
        scalar.expression,
      );
      controls.warpTexture.offsetX = nextX.value;
      controls.warpTexture.offsetY = nextY.value;
      expressions.warpTexture.offsetX = nextX.expression;
      expressions.warpTexture.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_scale') {
    const scale = vec2Result();
    const scalar = scale ? null : scalarResult();
    if (scale) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleX,
        expressions.warpTexture.scaleX,
        scale.values[0],
        scale.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleY,
        expressions.warpTexture.scaleY,
        scale.values[1],
        scale.expressions[1] ?? null,
      );
      controls.warpTexture.scaleX = nextX.value;
      controls.warpTexture.scaleY = nextY.value;
      expressions.warpTexture.scaleX = nextX.expression;
      expressions.warpTexture.scaleY = nextY.expression;
      return true;
    }
    if (scalar) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleX,
        expressions.warpTexture.scaleX,
        scalar.value,
        scalar.expression,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleY,
        expressions.warpTexture.scaleY,
        scalar.value,
        scalar.expression,
      );
      controls.warpTexture.scaleX = nextX.value;
      controls.warpTexture.scaleY = nextY.value;
      expressions.warpTexture.scaleX = nextX.expression;
      expressions.warpTexture.scaleY = nextY.expression;
      return true;
    }
  }

  if (key === 'ret' || key === 'shader_body') {
    const directSample = getShaderSampleInfo(resolvedExpression);
    if (directSample && directSample.source === 'main') {
      return true;
    }

    if (
      directSample &&
      directSample.source !== 'main' &&
      directSample.source !== 'none'
    ) {
      if (!isAuxShaderSamplerName(directSample.source)) {
        return false;
      }
      controls.textureLayer.mode = 'replace';
      controls.textureLayer.amount = 1;
      expressions.textureLayer.amount = createLiteralExpression(1);
      applyTextureLayerSample(controls, expressions, directSample);
      return true;
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '*' &&
      (isShaderSampleRgbExpression(resolvedExpression.left) ||
        isShaderSampleRgbExpression(resolvedExpression.right))
    ) {
      const scaleNode = isShaderSampleRgbExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const colorScale = evaluateShaderVectorResult(
        scaleNode,
        3,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (colorScale) {
        const nextR = applyShaderControlValue(
          operator,
          controls.colorScale.r,
          expressions.colorScale.r,
          colorScale.values[0],
          colorScale.expressions[0] ?? null,
        );
        const nextG = applyShaderControlValue(
          operator,
          controls.colorScale.g,
          expressions.colorScale.g,
          colorScale.values[1],
          colorScale.expressions[1] ?? null,
        );
        const nextB = applyShaderControlValue(
          operator,
          controls.colorScale.b,
          expressions.colorScale.b,
          colorScale.values[2],
          colorScale.expressions[2] ?? null,
        );
        controls.colorScale = {
          r: nextR.value,
          g: nextG.value,
          b: nextB.value,
        };
        expressions.colorScale = {
          r: nextR.expression,
          g: nextG.expression,
          b: nextB.expression,
        };
        shaderEnv.r = nextR.value;
        shaderEnv.g = nextG.value;
        shaderEnv.b = nextB.value;
        return true;
      }

      const scalarScale = evaluateShaderScalarResult(
        scaleNode,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (scalarScale) {
        (['r', 'g', 'b'] as const).forEach((channel) => {
          const next = applyShaderControlValue(
            operator,
            controls.colorScale[channel],
            expressions.colorScale[channel],
            scalarScale.value,
            scalarScale.expression,
          );
          controls.colorScale[channel] = next.value;
          expressions.colorScale[channel] = next.expression;
          shaderEnv[channel] = next.value;
        });
        return true;
      }
    }

    if (
      resolvedExpression.type === 'call' &&
      resolvedExpression.name.toLowerCase() === 'mix' &&
      resolvedExpression.args.length >= 3
    ) {
      // Canonical: mix(main, aux, amount)
      const isArg0Main = isShaderSampleRgbExpression(
        resolvedExpression.args[0] as MilkdropShaderExpressionNode,
      );
      // Swapped: mix(aux, main, amount) — treat as mix(main, aux, 1-amount)
      const isArg1Main =
        !isArg0Main &&
        isShaderSampleRgbExpression(
          resolvedExpression.args[1] as MilkdropShaderExpressionNode,
        );

      if (isArg0Main || isArg1Main) {
        const baseSampleArg = isArg0Main
          ? (resolvedExpression.args[0] as MilkdropShaderExpressionNode)
          : (resolvedExpression.args[1] as MilkdropShaderExpressionNode);
        const baseSample = getShaderSampleInfo(baseSampleArg);
        const rawAmount = evaluateShaderScalarResult(
          resolvedExpression.args[2] as MilkdropShaderExpressionNode,
          shaderValueEnv,
          shaderEnv,
          shaderExpressionEnv,
        );
        // When args are swapped (mix(aux, main, t)) the effective amount is (1-t)
        const amount =
          rawAmount && isArg1Main
            ? {
                value: 1 - rawAmount.value,
                expression: rawAmount.expression
                  ? ({
                      type: 'binary' as const,
                      operator: '-' as const,
                      left: createLiteralExpression(1),
                      right: rawAmount.expression,
                    } as MilkdropExpressionNode)
                  : null,
              }
            : rawAmount;
        if (amount && baseSample?.source === 'main') {
          const targetNode = isArg0Main
            ? (resolvedExpression.args[1] as MilkdropShaderExpressionNode)
            : (resolvedExpression.args[0] as MilkdropShaderExpressionNode);
          const auxSample = getShaderSampleInfo(targetNode);
          if (
            auxSample &&
            auxSample.source !== 'main' &&
            auxSample.source !== 'none'
          ) {
            if (!isAuxShaderSamplerName(auxSample.source)) {
              return false;
            }
            controls.textureLayer.mode = 'mix';
            controls.textureLayer.amount = amount.value;
            expressions.textureLayer.amount = amount.expression;
            applyTextureLayerSample(controls, expressions, auxSample);
            return true;
          }
          if (
            targetNode.type === 'binary' &&
            targetNode.operator === '*' &&
            (isShaderSampleRgbExpression(targetNode.left) ||
              isShaderSampleRgbExpression(targetNode.right))
          ) {
            const scaleNode = isShaderSampleRgbExpression(targetNode.left)
              ? targetNode.right
              : targetNode.left;
            const scale = evaluateShaderScalarResult(
              scaleNode,
              shaderValueEnv,
              shaderEnv,
              shaderExpressionEnv,
            );
            if (scale) {
              const factorExpression = buildTintBlendExpression(
                scale.expression ?? createLiteralExpression(scale.value),
                amount.expression,
              );
              const nextR = applyShaderControlValue(
                operator,
                controls.colorScale.r,
                expressions.colorScale.r,
                1 + (scale.value - 1) * amount.value,
                factorExpression,
              );
              const nextG = applyShaderControlValue(
                operator,
                controls.colorScale.g,
                expressions.colorScale.g,
                1 + (scale.value - 1) * amount.value,
                factorExpression,
              );
              const nextB = applyShaderControlValue(
                operator,
                controls.colorScale.b,
                expressions.colorScale.b,
                1 + (scale.value - 1) * amount.value,
                factorExpression,
              );
              controls.colorScale = {
                r: nextR.value,
                g: nextG.value,
                b: nextB.value,
              };
              expressions.colorScale = {
                r: nextR.expression,
                g: nextG.expression,
                b: nextB.expression,
              };
              shaderEnv.r = nextR.value;
              shaderEnv.g = nextG.value;
              shaderEnv.b = nextB.value;
              return true;
            }
          }
          const invertedSample =
            extractShaderInvertedSampleExpression(targetNode);
          if (invertedSample) {
            if (invertedSample === 'main') {
              const next = applyShaderControlValue(
                operator,
                controls.invertBoost,
                expressions.invertBoost,
                amount.value,
                amount.expression,
              );
              controls.invertBoost = next.value;
              expressions.invertBoost = next.expression;
              shaderEnv.invert = next.value;
              return true;
            }
            if (!isAuxShaderSamplerName(invertedSample.source)) {
              return false;
            }
            controls.textureLayer.mode = 'mix';
            controls.textureLayer.amount = amount.value;
            expressions.textureLayer.amount = amount.expression;
            applyTextureLayerSample(controls, expressions, invertedSample, {
              inverted: true,
            });
            return true;
          }
          if (isShaderSolarizeSampleExpression(targetNode)) {
            const next = applyShaderControlValue(
              operator,
              controls.solarizeBoost,
              expressions.solarizeBoost,
              amount.value,
              amount.expression,
            );
            controls.solarizeBoost = next.value;
            expressions.solarizeBoost = next.expression;
            shaderEnv.solarize = next.value;
            return true;
          }
          const tint = evaluateShaderVectorResult(
            targetNode,
            3,
            shaderValueEnv,
            shaderEnv,
            shaderExpressionEnv,
          );
          if (tint) {
            const nextR = applyShaderControlValue(
              operator,
              controls.tint.r,
              expressions.tint.r,
              1 + (tint.values[0] - 1) * amount.value,
              buildTintBlendExpression(
                tint.expressions[0] ?? null,
                amount.expression,
              ),
            );
            const nextG = applyShaderControlValue(
              operator,
              controls.tint.g,
              expressions.tint.g,
              1 + (tint.values[1] - 1) * amount.value,
              buildTintBlendExpression(
                tint.expressions[1] ?? null,
                amount.expression,
              ),
            );
            const nextB = applyShaderControlValue(
              operator,
              controls.tint.b,
              expressions.tint.b,
              1 + (tint.values[2] - 1) * amount.value,
              buildTintBlendExpression(
                tint.expressions[2] ?? null,
                amount.expression,
              ),
            );
            controls.tint = {
              r: nextR.value,
              g: nextG.value,
              b: nextB.value,
            };
            expressions.tint = {
              r: nextR.expression,
              g: nextG.expression,
              b: nextB.expression,
            };
            shaderEnv.tint_r = nextR.value;
            shaderEnv.tint_g = nextG.value;
            shaderEnv.tint_b = nextB.value;
            return true;
          }
        }
      }
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '+' &&
      (isShaderMainSampleExpression(resolvedExpression.left) ||
        isShaderMainSampleExpression(resolvedExpression.right))
    ) {
      const auxNode = isShaderMainSampleExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const auxSample = extractScaledShaderSampleExpression(auxNode);
      if (auxSample) {
        if (!isAuxShaderSamplerName(auxSample.sample.source)) {
          return false;
        }
        controls.textureLayer.mode = 'add';
        controls.textureLayer.amount = auxSample.amountValue;
        expressions.textureLayer.amount = auxSample.amountExpression;
        applyTextureLayerSample(controls, expressions, auxSample.sample);
        return true;
      }
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '*' &&
      (isShaderMainSampleExpression(resolvedExpression.left) ||
        isShaderMainSampleExpression(resolvedExpression.right))
    ) {
      const auxNode = isShaderMainSampleExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const auxSample = extractScaledShaderSampleExpression(auxNode);
      if (auxSample) {
        if (!isAuxShaderSamplerName(auxSample.sample.source)) {
          return false;
        }
        controls.textureLayer.mode = 'multiply';
        controls.textureLayer.amount = auxSample.amountValue;
        expressions.textureLayer.amount = auxSample.amountExpression;
        applyTextureLayerSample(controls, expressions, auxSample.sample);
        return true;
      }
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '-' &&
      isShaderMainSampleExpression(resolvedExpression.left)
    ) {
      // Only main - aux*amount is meaningful (not aux - main)
      const auxSample = extractScaledShaderSampleExpression(
        resolvedExpression.right,
      );
      if (auxSample) {
        if (!isAuxShaderSamplerName(auxSample.sample.source)) {
          return false;
        }
        controls.textureLayer.mode = 'subtract';
        controls.textureLayer.amount = auxSample.amountValue;
        expressions.textureLayer.amount = auxSample.amountExpression;
        applyTextureLayerSample(controls, expressions, auxSample.sample);
        return true;
      }
    }
  } // end if (key === 'ret' || key === 'shader_body')

  const numeric = scalarResult();
  if (
    numeric &&
    applyShaderScalarAliasControl(
      {
        controls,
        expressions,
        shaderEnv,
      },
      key,
      operator,
      numeric,
    )
  ) {
    return true;
  }

  const evaluatedValue = evaluateMilkdropShaderExpression(
    resolvedExpression,
    shaderValueEnv,
    shaderEnv,
  );
  const baseKey = key.split('.')[0] ?? key;
  if (
    baseKey === 'uv' ||
    baseKey === 'ret' ||
    baseKey === 'shader_body' ||
    baseKey === 'tint' ||
    isKnownShaderScalarKey(baseKey)
  ) {
    return false;
  }
  if (!evaluatedValue) {
    return false;
  }
  shaderValueEnv[key] = evaluatedValue;
  shaderExpressionEnv[key] = statement.expression;
  if (isShaderScalarValue(evaluatedValue)) {
    shaderEnv[key] = evaluatedValue.value;
  }
  return true;
}

function applyShaderProgramHeuristicLine({
  key,
  operator,
  rawValue,
  controls,
  expressions,
  shaderEnv,
}: {
  key: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  rawValue: string;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
}) {
  const normalizedValue = normalizeShaderSyntax(rawValue)
    .replace(/\s+/gu, '')
    .toLowerCase();
  const numeric = parseShaderScalar(rawValue, shaderEnv);

  if (
    applyShaderHeuristicControlStatement({
      key,
      operator,
      rawValue,
      numeric,
      controls,
      expressions,
      shaderEnv,
    })
  ) {
    return true;
  }

  if (key === 'shader_body' && isIdentityTextureSampleExpression(rawValue)) {
    return true;
  }

  const uvOffset =
    key === 'uv'
      ? operator === '+=' || operator === '-='
        ? parseShaderVec2Constructor(rawValue, shaderEnv)
        : null
      : null;
  if (key === 'uv' && uvOffset) {
    const xSign = operator === '-=' ? -1 : 1;
    const ySign = operator === '-=' ? -1 : 1;
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      uvOffset.value.x * xSign,
      uvOffset.expressions.x,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      uvOffset.value.y * ySign,
      uvOffset.expressions.y,
    );
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  const offsetMatch = normalizedValue.match(/^uv([+-])vec2\((.+),(.+)\)$/u);
  if (key === 'uv' && operator === '=' && offsetMatch) {
    const xScalar = parseShaderScalar(offsetMatch[2] ?? '', shaderEnv);
    const yScalar = parseShaderScalar(offsetMatch[3] ?? '', shaderEnv);
    if (!xScalar || !yScalar) {
      return false;
    }
    const xSign = offsetMatch[1] === '-' ? -1 : 1;
    const ySign = offsetMatch[1] === '-' ? -1 : 1;
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      xScalar.value * xSign,
      xScalar.expression,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      yScalar.value * ySign,
      yScalar.expression,
    );
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  const uvAffineMatch = normalizedValue.match(
    /^\(uv-0\.5\)([*/])([^+]+)\+0\.5([+-])vec2\((.+),(.+)\)$/u,
  );
  if (key === 'uv' && operator === '=' && uvAffineMatch) {
    const zoomScalar = parseShaderScalar(uvAffineMatch[2] ?? '', shaderEnv);
    const offset = parseShaderVec2List(
      `${uvAffineMatch[4]}, ${uvAffineMatch[5]}`,
      shaderEnv,
    );
    if (!zoomScalar || !offset) {
      return false;
    }
    const offsetSign = uvAffineMatch[3] === '-' ? -1 : 1;
    // `(uv-0.5)*z+0.5` scales the sampling coordinate by z (zoom control 1/z,
    // zoom out for z>1); `(uv-0.5)/z+0.5` scales by 1/z (zoom control z, zoom
    // in for z>1). Mirrors applyMainUvTransformControls' 1/scale convention.
    const zoomValue =
      uvAffineMatch[1] === '*' && zoomScalar.value !== 0
        ? 1 / zoomScalar.value
        : zoomScalar.value;
    const nextZoom = applyShaderControlValue(
      '=',
      controls.zoom,
      expressions.zoom,
      zoomValue,
      zoomScalar.expression,
    );
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      offset.value.x * offsetSign,
      offset.expressions.x,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      offset.value.y * offsetSign,
      offset.expressions.y,
    );
    controls.zoom = nextZoom.value;
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.zoom = nextZoom.expression;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.zoom = nextZoom.value;
    shaderEnv.scale = nextZoom.value;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  if (key !== 'ret' && key !== 'shader_body') {
    return false;
  }

  if (isIdentityTextureSampleExpression(rawValue)) {
    return true;
  }

  const scaleMatch = normalizedValue.match(
    /^tex2d\(sampler_main,uv\)\.rgb\*(.+)$/u,
  );
  if (scaleMatch) {
    const scalar = parseShaderScalar(scaleMatch[1] ?? '', shaderEnv);
    if (!scalar) {
      return false;
    }
    const channels: Array<'r' | 'g' | 'b'> = ['r', 'g', 'b'];
    channels.forEach((channel) => {
      const next = applyShaderControlValue(
        operator,
        controls.colorScale[channel],
        expressions.colorScale[channel],
        scalar.value,
        scalar.expression,
      );
      controls.colorScale[channel] = next.value;
      expressions.colorScale[channel] = next.expression;
      shaderEnv[channel] = next.value;
    });
    return true;
  }

  const powMatch = normalizedValue.match(
    /^pow\(tex2d\(sampler_main,uv\)\.rgb,vec3\((.+)\)\)$/u,
  );
  if (powMatch) {
    const scalar = parseShaderScalar(powMatch[1] ?? '', shaderEnv);
    if (!scalar || scalar.value === 0) {
      return false;
    }
    const gammaValue = 1 / scalar.value;
    shaderEnv.gammaadj = gammaValue;
    return true;
  }

  const vecScaleMatch = normalizedValue.match(
    /^tex2d\(sampler_main,uv\)\.rgb\*vec3\((.+),(.+),(.+)\)$/u,
  );
  if (vecScaleMatch) {
    const tint = parseShaderTintList(
      `${vecScaleMatch[1]}, ${vecScaleMatch[2]}, ${vecScaleMatch[3]}`,
      shaderEnv,
    );
    if (!tint) {
      return false;
    }
    const nextR = applyShaderControlValue(
      operator,
      controls.colorScale.r,
      expressions.colorScale.r,
      tint.value.r,
      tint.expressions.r,
    );
    const nextG = applyShaderControlValue(
      operator,
      controls.colorScale.g,
      expressions.colorScale.g,
      tint.value.g,
      tint.expressions.g,
    );
    const nextB = applyShaderControlValue(
      operator,
      controls.colorScale.b,
      expressions.colorScale.b,
      tint.value.b,
      tint.expressions.b,
    );
    controls.colorScale = {
      r: nextR.value,
      g: nextG.value,
      b: nextB.value,
    };
    expressions.colorScale = {
      r: nextR.expression,
      g: nextG.expression,
      b: nextB.expression,
    };
    shaderEnv.r = nextR.value;
    shaderEnv.g = nextG.value;
    shaderEnv.b = nextB.value;
    return true;
  }

  const mixPattern = parseShaderSampleMixPattern(rawValue);
  if (mixPattern) {
    const amount = parseShaderScalar(mixPattern.amount, shaderEnv);
    if (!amount) {
      return false;
    }
    const invertLeft = isIdentityTextureSampleExpression(mixPattern.left);
    const invertRight =
      mixPattern.right === '1.0-tex2d(sampler_main,uv).rgb' ||
      mixPattern.right === '1-tex2d(sampler_main,uv).rgb';
    if (invertLeft && invertRight) {
      const next = applyShaderControlValue(
        operator,
        controls.invertBoost,
        expressions.invertBoost,
        amount.value,
        amount.expression,
      );
      controls.invertBoost = next.value;
      expressions.invertBoost = next.expression;
      shaderEnv.invert = next.value;
      return true;
    }

    const solarizeRight =
      mixPattern.right === 'abs(tex2d(sampler_main,uv).rgb-0.5)*1.5' ||
      mixPattern.right === 'abs(tex2d(sampler_main,uv).rgb-vec3(0.5))*1.5';
    if (invertLeft && solarizeRight) {
      const next = applyShaderControlValue(
        operator,
        controls.solarizeBoost,
        expressions.solarizeBoost,
        amount.value,
        amount.expression,
      );
      controls.solarizeBoost = next.value;
      expressions.solarizeBoost = next.expression;
      shaderEnv.solarize = next.value;
      return true;
    }

    const tintVec = parseShaderVec3Constructor(mixPattern.right, shaderEnv);
    if (invertLeft && tintVec) {
      const nextR = applyShaderControlValue(
        operator,
        controls.tint.r,
        expressions.tint.r,
        1 + (tintVec.value.r - 1) * amount.value,
        tintVec.expressions.r,
      );
      const nextG = applyShaderControlValue(
        operator,
        controls.tint.g,
        expressions.tint.g,
        1 + (tintVec.value.g - 1) * amount.value,
        tintVec.expressions.g,
      );
      const nextB = applyShaderControlValue(
        operator,
        controls.tint.b,
        expressions.tint.b,
        1 + (tintVec.value.b - 1) * amount.value,
        tintVec.expressions.b,
      );
      controls.tint = {
        r: nextR.value,
        g: nextG.value,
        b: nextB.value,
      };
      expressions.tint = {
        r: nextR.expression,
        g: nextG.expression,
        b: nextB.expression,
      };
      shaderEnv.tint_r = nextR.value;
      shaderEnv.tint_g = nextG.value;
      shaderEnv.tint_b = nextB.value;
      return true;
    }
  }

  if (
    normalizedValue === '1.0-tex2d(sampler_main,uv).rgb' ||
    normalizedValue === '1-tex2d(sampler_main,uv).rgb'
  ) {
    const next = applyShaderControlValue(
      operator,
      controls.invertBoost,
      expressions.invertBoost,
      1,
      createLiteralExpression(1),
    );
    controls.invertBoost = next.value;
    expressions.invertBoost = next.expression;
    shaderEnv.invert = next.value;
    return true;
  }

  if (
    normalizedValue === 'abs(tex2d(sampler_main,uv).rgb-0.5)*1.5' ||
    normalizedValue === 'abs(tex2d(sampler_main,uv).rgb-vec3(0.5))*1.5'
  ) {
    const next = applyShaderControlValue(
      operator,
      controls.solarizeBoost,
      expressions.solarizeBoost,
      1,
      createLiteralExpression(1),
    );
    controls.solarizeBoost = next.value;
    expressions.solarizeBoost = next.expression;
    shaderEnv.solarize = next.value;
    return true;
  }

  return false;
}

// `extractShaderControls` runs on every frame via the VM's post-effects
// builder, but the text->AST half of it depends only on the shader source,
// which is fixed for the lifetime of a preset. These caches hold that half so
// a preset with pixel-shader sections is tokenised once instead of 60x/sec.
// Only the expression *evaluation* below stays per-frame, since it reads the
// live `env`. Cached statement nodes are frozen before exposure so one
// consumer cannot corrupt every later analysis of the same source.
const MAX_CACHED_SHADER_SOURCES = 64;
const MAX_CACHED_SHADER_LINES = 4096;

type ShaderSourcePrep = {
  nativeShaderBody: string | null;
  normalized: string[];
};

const shaderSourcePrepCache = new Map<string, ShaderSourcePrep>();
const shaderStatementCache = new Map<string, MilkdropShaderStatement | null>();

function freezeCachedValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nestedValue of Object.values(value)) {
    freezeCachedValue(nestedValue);
  }
  return Object.freeze(value);
}

function evictOldest(cache: Map<string, unknown>, limit: number) {
  while (cache.size > limit) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}

function prepareShaderSource(shaderText: string): ShaderSourcePrep {
  const cached = shaderSourcePrepCache.get(shaderText);
  if (cached) {
    return cached;
  }
  const nativeShaderBody = extractNativeShaderBody(shaderText);
  // Branches have no place in the statement model, so a body that branches
  // used to be unparseable — WebGPU fell back to uniform-only controls while
  // WebGL ran the raw GLSL. Flattening `if`/`else` into masked assignments
  // first keeps those presets on the direct path; the raw GLSL WebGL executes
  // is extracted from the original text and is untouched by this.
  const statementBody = nativeShaderBody
    ? (desugarShaderBranches(nativeShaderBody) ?? nativeShaderBody)
    : null;
  const prep: ShaderSourcePrep = {
    nativeShaderBody,
    normalized: statementBody
      ? statementBody
          .split(/;\n?/u)
          .map((line) =>
            line
              .replace(/\/\/.*$/u, '')
              .replace(/\n/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter(Boolean)
      : shaderText
          .split(/[\r\n;]+/u)
          .map((line) => line.replace(/\/\/.*$/u, '').trim())
          .filter(Boolean),
  };
  shaderSourcePrepCache.set(shaderText, prep);
  evictOldest(shaderSourcePrepCache, MAX_CACHED_SHADER_SOURCES);
  return prep;
}

function parseShaderStatementCached(line: string) {
  if (shaderStatementCache.has(line)) {
    return shaderStatementCache.get(line) ?? null;
  }
  const parsed = freezeCachedValue(parseMilkdropShaderStatement(line));
  shaderStatementCache.set(line, parsed);
  evictOldest(shaderStatementCache, MAX_CACHED_SHADER_LINES);
  return parsed;
}

export function clearShaderAnalysisCaches() {
  shaderSourcePrepCache.clear();
  shaderStatementCache.clear();
}

export function extractShaderControls(
  shaderText: string | null,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  if (!shaderText) {
    return {
      controls: createDefaultShaderControls(),
      expressions: createDefaultShaderControlExpressions(),
      unsupportedLines: [],
      supported: false,
      statements: [],
      directProgramStatements: [],
      directProgramLines: [],
      directProgramRequired: false,
      hasNativeBody: false,
      nativeBodyUnparsedLines: [],
    };
  }

  const { nativeShaderBody, normalized } = prepareShaderSource(shaderText);

  const controls = createDefaultShaderControls();
  const expressions = createDefaultShaderControlExpressions();
  const shaderEnv: Record<string, number> = {
    ...env,
    ...controls.colorScale,
    tint_r: controls.tint.r,
    tint_g: controls.tint.g,
    tint_b: controls.tint.b,
  };
  const shaderValueEnv: ShaderRuntimeEnv = {
    uv: {
      kind: 'vec2',
      value: [0, 0],
    },
  };
  const shaderExpressionEnv: ShaderExpressionEnv = {};
  const unsupportedLines: string[] = [];
  const statements: MilkdropShaderStatement[] = [];
  const directProgramStatements: MilkdropShaderStatement[] = [];
  const directProgramLines: string[] = [];
  let directProgramRequired = false;

  // When processing a native shader_body, parse failures don't make the
  // raw GLSL invalid — WebGL can still execute it. Unparseable lines only
  // affect whether the WebGPU TSL path can do direct execution. Track them
  // separately so unsupportedLines stays clean for native bodies.
  const nativeBodyUnparsedLines: string[] = [];
  const trackUnsupported = (line: string) => {
    if (nativeShaderBody) {
      nativeBodyUnparsedLines.push(line);
    } else {
      unsupportedLines.push(line);
    }
  };

  let supportedLineCount = 0;
  normalized.forEach((line) => {
    const parsedStatement = parseShaderStatementCached(line);
    if (parsedStatement) {
      statements.push(parsedStatement);
      const requiresDirectProgram = shouldEmitDirectProgramStatement(
        parsedStatement.target,
      );
      const retainsDirectProgramContext =
        shouldRetainDirectProgramContextStatement(parsedStatement.target);
      const prefersDirectProgram = shouldPreferDirectProgramExecution(
        parsedStatement.target,
        parsedStatement.expression,
      );
      const pushDirectProgramStatement = () => {
        directProgramStatements.push(parsedStatement);
        directProgramLines.push(line);
        if (prefersDirectProgram || requiresDirectProgram) {
          directProgramRequired = true;
        }
      };
      if (
        applyShaderAstStatement({
          statement: parsedStatement,
          controls,
          expressions,
          shaderEnv,
          shaderValueEnv,
          shaderExpressionEnv,
          hasNativeBody: Boolean(nativeShaderBody),
        })
      ) {
        if (
          retainsDirectProgramContext ||
          prefersDirectProgram ||
          shouldEmitDirectProgramStatement(parsedStatement.target)
        ) {
          pushDirectProgramStatement();
        }
        supportedLineCount += 1;
        return;
      }
      if (
        applyShaderProgramHeuristicLine({
          key: parsedStatement.target.toLowerCase(),
          operator: parsedStatement.operator,
          rawValue: parsedStatement.rawValue,
          controls,
          expressions,
          shaderEnv,
        })
      ) {
        if (prefersDirectProgram || requiresDirectProgram) {
          pushDirectProgramStatement();
        }
        supportedLineCount += 1;
        return;
      }
      if (
        isUnsupportedParsedShaderStatement({
          statement: parsedStatement,
          shaderEnv,
          shaderValueEnv,
          shaderExpressionEnv,
        })
      ) {
        trackUnsupported(line);
        return;
      }
      if (requiresDirectProgram) {
        pushDirectProgramStatement();
        directProgramRequired = true;
        supportedLineCount += 1;
        return;
      }
      if (retainsDirectProgramContext) {
        pushDirectProgramStatement();
        supportedLineCount += 1;
        return;
      }
      supportedLineCount += 1;
      return;
    }

    const fallbackAssignment = line.match(
      /^(?:(?:const|float|vec2|vec3|float2|float3)\s+)?([a-z_][a-z0-9_]*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/iu,
    );
    if (!fallbackAssignment) {
      // Pure GLSL declarations (e.g. `vec2 tmpvar_1`, `vec4 tmpvar_2`) carry
      // no executable logic — silently skip them instead of marking them
      // unsupported. This lets native shader_body lines flow through the
      // statement parser so the WebGPU TSL path can execute them.
      if (
        /^(?:float|int|bool|vec[234]|mat[234]|float2|float3|float4)\s+[a-z_]\w*(?:\s*,\s*[a-z_]\w*)*\s*$/iu.test(
          line,
        )
      ) {
        return;
      }
      // Bare declaration tails (e.g. `vec2 tmpvar_2;` split such that the type
      // was consumed by a prior statement) carry no executable logic.
      if (/^[a-z_]\w*\s*$/u.test(line)) {
        return;
      }
      // Control-flow lines (if/else/braces) don't translate to the TSL
      // statement model — branching is unsupported, and the parser splits the
      // body on `;` so an `if (...) { stmt` segment swallows the branch body
      // into the structural line. Record them so native bodies are classified
      // as not WebGPU-direct-executable and fall back to WebGL's raw GLSL
      // instead of silently dropping the branch statements.
      if (
        /^\}\s*(?:else\s*\{.*)?$/u.test(line) ||
        /^if\s*\(.*\)\s*\{.*$/u.test(line) ||
        /^else\s*\{.*$/u.test(line)
      ) {
        if (nativeShaderBody) {
          nativeBodyUnparsedLines.push(line);
        } else {
          trackUnsupported(line);
        }
        return;
      }
      // For native shader bodies, parse failures don't invalidate the raw
      // GLSL — they only mean the TSL path can't execute that line. Track
      // separately so WebGL keeps direct execution via rawGlsl.
      if (nativeShaderBody) {
        nativeBodyUnparsedLines.push(line);
        return;
      }
      trackUnsupported(line);
      return;
    }
    const key = fallbackAssignment[1]?.toLowerCase() ?? '';
    const operator =
      (fallbackAssignment[2] as '=' | '+=' | '-=' | '*=' | '/=') ?? '=';
    const rawValue = fallbackAssignment[3]?.trim() ?? '';

    if (
      applyShaderProgramHeuristicLine({
        key,
        operator,
        rawValue,
        controls,
        expressions,
        shaderEnv,
      })
    ) {
      supportedLineCount += 1;
      return;
    }
    const numeric = parseShaderScalar(rawValue, shaderEnv);
    if (
      !isKnownShaderScalarKey(key) &&
      !new Set([
        'tint',
        'texture_source',
        'texture_mode',
        'warp_texture_source',
      ]).has(key)
    ) {
      if (numeric !== null) {
        const currentValue = shaderEnv[key] ?? 0;
        const next = applyShaderExpressionOperator(
          operator,
          currentValue,
          null,
          numeric.value,
          numeric.expression,
        );
        shaderEnv[key] = next.value;
        supportedLineCount += 1;
        return;
      }
      if (parsedStatement) {
        directProgramStatements.push(parsedStatement);
        directProgramLines.push(line);
        return;
      }
      trackUnsupported(line);
      return;
    }
    switch (key) {
      case 'tint': {
        const tint = parseShaderTintList(rawValue, shaderEnv);
        if (tint) {
          const nextR = applyShaderExpressionOperator(
            operator,
            controls.tint.r,
            expressions.tint.r,
            tint.value.r,
            tint.expressions.r,
          );
          const nextG = applyShaderExpressionOperator(
            operator,
            controls.tint.g,
            expressions.tint.g,
            tint.value.g,
            tint.expressions.g,
          );
          const nextB = applyShaderExpressionOperator(
            operator,
            controls.tint.b,
            expressions.tint.b,
            tint.value.b,
            tint.expressions.b,
          );
          controls.tint = {
            r: nextR.value,
            g: nextG.value,
            b: nextB.value,
          };
          expressions.tint = {
            r: nextR.expression,
            g: nextG.expression,
            b: nextB.expression,
          };
          shaderEnv.tint_r = nextR.value;
          shaderEnv.tint_g = nextG.value;
          shaderEnv.tint_b = nextB.value;
          supportedLineCount += 1;
          return;
        }
        break;
      }
    }
    trackUnsupported(line);
  });

  return {
    controls,
    expressions,
    unsupportedLines,
    supported:
      supportedLineCount > 0 &&
      unsupportedLines.length === 0 &&
      !directProgramRequired,
    statements,
    directProgramStatements,
    directProgramLines,
    directProgramRequired,
    hasNativeBody: Boolean(nativeShaderBody),
    nativeBodyUnparsedLines,
  };
}

export function evaluateMilkdropShaderControlProgram({
  warp,
  comp,
  env,
}: {
  warp: string | null;
  comp: string | null;
  env: Record<string, number>;
}) {
  const warpAnalysis = extractShaderControls(warp, env);
  const compAnalysis = extractShaderControls(comp, env);
  return mergeShaderControlAnalysis(warpAnalysis, compAnalysis).controls;
}
