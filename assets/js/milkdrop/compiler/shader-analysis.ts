import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../shader-ast';
import type {
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
  applyShaderControlValue,
  applyShaderExpressionOperator,
  applyTextureLayerSample,
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

function applyShaderAstStatement({
  statement,
  controls,
  expressions,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
}: {
  statement: MilkdropShaderStatement;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
}) {
  const key = statement.target.toLowerCase();
  const operator = statement.operator;
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  if (hasUnsupportedVolumeSample(resolvedExpression)) {
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
    shaderExpressionEnv[key] = resolvedExpression;
    return true;
  }

  if (key === 'texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    if (!source || !isAuxShaderSamplerName(source)) {
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
  }

  if (key === 'texture_scale') {
    const scale = vec2Result();
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
  }

  if (key === 'warp_texture_offset' || key === 'warp_texture_scroll') {
    const offset = vec2Result();
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
  }

  if (key === 'warp_texture_scale') {
    const scale = vec2Result();
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
      resolvedExpression.args.length >= 3 &&
      isShaderSampleRgbExpression(
        resolvedExpression.args[0] as MilkdropShaderExpressionNode,
      )
    ) {
      const baseSample = getShaderSampleInfo(
        resolvedExpression.args[0] as MilkdropShaderExpressionNode,
      );
      const amount = evaluateShaderScalarResult(
        resolvedExpression.args[2] as MilkdropShaderExpressionNode,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (amount && baseSample?.source === 'main') {
        const targetNode = resolvedExpression
          .args[1] as MilkdropShaderExpressionNode;
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
  }

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
  shaderExpressionEnv[key] = resolvedExpression;
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
    const zoomValue =
      uvAffineMatch[1] === '/' && zoomScalar.value !== 0
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
    };
  }

  const normalized = shaderText
    .split(/[\r\n;]+/u)
    .map((line) => line.replace(/\/\/.*$/u, '').trim())
    .filter(Boolean);
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

  let supportedLineCount = 0;
  normalized.forEach((line) => {
    const parsedStatement = parseMilkdropShaderStatement(line);
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
        if (prefersDirectProgram) {
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
        })
      ) {
        if (retainsDirectProgramContext || prefersDirectProgram) {
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
        if (prefersDirectProgram) {
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
        unsupportedLines.push(line);
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
      unsupportedLines.push(line);
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
      unsupportedLines.push(line);
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
    unsupportedLines.push(line);
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
