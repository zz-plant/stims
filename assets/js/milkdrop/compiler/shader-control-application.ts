import type {
  MilkdropExpressionNode,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
} from '../types';
import {
  applyShaderExpressionOperator,
  isAuxShaderSamplerName,
  normalizeShaderSamplerName,
  normalizeShaderTextureBlendMode,
  parseShaderSamplerSource,
  parseShaderTextureBlendMode,
} from './shader-analysis-helpers';

type ShaderNumericResult = {
  value: number;
  expression: MilkdropExpressionNode | null;
};

export type ShaderControlApplicationContext = {
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
};

function applyNumericControlValue({
  operator,
  numeric,
  currentValue,
  currentExpression,
}: {
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  numeric: ShaderNumericResult;
  currentValue: number;
  currentExpression: MilkdropExpressionNode | null;
}) {
  return applyShaderExpressionOperator(
    operator,
    currentValue,
    currentExpression,
    numeric.value,
    numeric.expression,
  );
}

function applyScalarAssignment(
  context: ShaderControlApplicationContext,
  {
    operator,
    numeric,
    currentValue,
    currentExpression,
    setValue,
    setExpression,
    envKeys,
  }: {
    operator: '=' | '+=' | '-=' | '*=' | '/=';
    numeric: ShaderNumericResult;
    currentValue: number;
    currentExpression: MilkdropExpressionNode | null;
    setValue: (value: number) => void;
    setExpression: (expression: MilkdropExpressionNode | null) => void;
    envKeys?: readonly string[];
  },
) {
  const next = applyNumericControlValue({
    operator,
    numeric,
    currentValue,
    currentExpression,
  });
  setValue(next.value);
  setExpression(next.expression);
  envKeys?.forEach((envKey) => {
    context.shaderEnv[envKey] = next.value;
  });
  return true;
}

function applyTextureSourceAssignment({
  target,
  rawValue,
  resolvedExpression,
  context,
}: {
  target: 'texture_source' | 'warp_texture_source';
  rawValue: string;
  resolvedExpression: MilkdropShaderExpressionNode | null;
  context: ShaderControlApplicationContext;
}) {
  const source =
    resolvedExpression?.type === 'identifier'
      ? normalizeShaderSamplerName(resolvedExpression.name)
      : parseShaderSamplerSource(rawValue);
  if (!source || !isAuxShaderSamplerName(source)) {
    return false;
  }
  if (target === 'texture_source') {
    context.controls.textureLayer.source = source;
    if (context.controls.textureLayer.mode === 'none') {
      context.controls.textureLayer.mode = 'mix';
    }
    return true;
  }
  context.controls.warpTexture.source = source;
  return true;
}

function applyTextureModeAssignment({
  rawValue,
  resolvedExpression,
  context,
}: {
  rawValue: string;
  resolvedExpression: MilkdropShaderExpressionNode | null;
  context: ShaderControlApplicationContext;
}) {
  const mode =
    resolvedExpression?.type === 'identifier'
      ? normalizeShaderTextureBlendMode(resolvedExpression.name)
      : parseShaderTextureBlendMode(rawValue);
  if (!mode) {
    return false;
  }
  context.controls.textureLayer.mode = mode;
  return true;
}

export function applyShaderScalarAliasControl(
  context: ShaderControlApplicationContext,
  key: string,
  operator: '=' | '+=' | '-=' | '*=' | '/=',
  numeric: ShaderNumericResult,
) {
  switch (key) {
    case 'warp':
    case 'warp_scale': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpScale,
        currentExpression: context.expressions.warpScale,
        setValue: (value) => {
          context.controls.warpScale = value;
        },
        setExpression: (expression) => {
          context.expressions.warpScale = expression;
        },
        envKeys: ['warp', 'warp_scale'],
      });
    }
    case 'dx':
    case 'offset_x':
    case 'translate_x': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.offsetX,
        currentExpression: context.expressions.offsetX,
        setValue: (value) => {
          context.controls.offsetX = value;
        },
        setExpression: (expression) => {
          context.expressions.offsetX = expression;
        },
        envKeys: ['dx', 'offset_x', 'translate_x'],
      });
    }
    case 'dy':
    case 'offset_y':
    case 'translate_y': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.offsetY,
        currentExpression: context.expressions.offsetY,
        setValue: (value) => {
          context.controls.offsetY = value;
        },
        setExpression: (expression) => {
          context.expressions.offsetY = expression;
        },
        envKeys: ['dy', 'offset_y', 'translate_y'],
      });
    }
    case 'rot':
    case 'rotation': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.rotation,
        currentExpression: context.expressions.rotation,
        setValue: (value) => {
          context.controls.rotation = value;
        },
        setExpression: (expression) => {
          context.expressions.rotation = expression;
        },
        envKeys: ['rot', 'rotation'],
      });
    }
    case 'zoom':
    case 'scale': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.zoom,
        currentExpression: context.expressions.zoom,
        setValue: (value) => {
          context.controls.zoom = value;
        },
        setExpression: (expression) => {
          context.expressions.zoom = expression;
        },
        envKeys: ['zoom', 'scale'],
      });
    }
    case 'saturation':
    case 'sat': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.saturation,
        currentExpression: context.expressions.saturation,
        setValue: (value) => {
          context.controls.saturation = value;
        },
        setExpression: (expression) => {
          context.expressions.saturation = expression;
        },
        envKeys: ['saturation', 'sat'],
      });
    }
    case 'contrast': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.contrast,
        currentExpression: context.expressions.contrast,
        setValue: (value) => {
          context.controls.contrast = value;
        },
        setExpression: (expression) => {
          context.expressions.contrast = expression;
        },
        envKeys: ['contrast'],
      });
    }
    case 'r':
    case 'red': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.colorScale.r,
        currentExpression: context.expressions.colorScale.r,
        setValue: (value) => {
          context.controls.colorScale.r = value;
        },
        setExpression: (expression) => {
          context.expressions.colorScale.r = expression;
        },
        envKeys: ['r', 'red'],
      });
    }
    case 'g':
    case 'green': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.colorScale.g,
        currentExpression: context.expressions.colorScale.g,
        setValue: (value) => {
          context.controls.colorScale.g = value;
        },
        setExpression: (expression) => {
          context.expressions.colorScale.g = expression;
        },
        envKeys: ['g', 'green'],
      });
    }
    case 'b':
    case 'blue': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.colorScale.b,
        currentExpression: context.expressions.colorScale.b,
        setValue: (value) => {
          context.controls.colorScale.b = value;
        },
        setExpression: (expression) => {
          context.expressions.colorScale.b = expression;
        },
        envKeys: ['b', 'blue'],
      });
    }
    case 'hue':
    case 'hue_shift': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.hueShift,
        currentExpression: context.expressions.hueShift,
        setValue: (value) => {
          context.controls.hueShift = value;
        },
        setExpression: (expression) => {
          context.expressions.hueShift = expression;
        },
        envKeys: ['hue', 'hue_shift'],
      });
    }
    case 'mix':
    case 'feedback':
    case 'feedback_alpha': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.mixAlpha,
        currentExpression: context.expressions.mixAlpha,
        setValue: (value) => {
          context.controls.mixAlpha = value;
        },
        setExpression: (expression) => {
          context.expressions.mixAlpha = expression;
        },
        envKeys: ['mix', 'feedback', 'feedback_alpha'],
      });
    }
    case 'brighten': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.brightenBoost,
        currentExpression: context.expressions.brightenBoost,
        setValue: (value) => {
          context.controls.brightenBoost = value;
        },
        setExpression: (expression) => {
          context.expressions.brightenBoost = expression;
        },
        envKeys: ['brighten'],
      });
    }
    case 'invert': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.invertBoost,
        currentExpression: context.expressions.invertBoost,
        setValue: (value) => {
          context.controls.invertBoost = value;
        },
        setExpression: (expression) => {
          context.expressions.invertBoost = expression;
        },
        envKeys: ['invert'],
      });
    }
    case 'solarize': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.solarizeBoost,
        currentExpression: context.expressions.solarizeBoost,
        setValue: (value) => {
          context.controls.solarizeBoost = value;
        },
        setExpression: (expression) => {
          context.expressions.solarizeBoost = expression;
        },
        envKeys: ['solarize'],
      });
    }
    case 'texture_amount':
    case 'texture_mix': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.textureLayer.amount,
        currentExpression: context.expressions.textureLayer.amount,
        setValue: (value) => {
          context.controls.textureLayer.amount = value;
        },
        setExpression: (expression) => {
          context.expressions.textureLayer.amount = expression;
        },
      });
    }
    case 'texture_scale':
    case 'texture_scale_x': {
      const applied = applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.textureLayer.scaleX,
        currentExpression: context.expressions.textureLayer.scaleX,
        setValue: (value) => {
          context.controls.textureLayer.scaleX = value;
        },
        setExpression: (expression) => {
          context.expressions.textureLayer.scaleX = expression;
        },
      });
      if (key === 'texture_scale') {
        context.controls.textureLayer.scaleY =
          context.controls.textureLayer.scaleX;
        context.expressions.textureLayer.scaleY =
          context.expressions.textureLayer.scaleX;
      }
      return applied;
    }
    case 'texture_scale_y': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.textureLayer.scaleY,
        currentExpression: context.expressions.textureLayer.scaleY,
        setValue: (value) => {
          context.controls.textureLayer.scaleY = value;
        },
        setExpression: (expression) => {
          context.expressions.textureLayer.scaleY = expression;
        },
      });
    }
    case 'texture_offset_x':
    case 'texture_scroll_x': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.textureLayer.offsetX,
        currentExpression: context.expressions.textureLayer.offsetX,
        setValue: (value) => {
          context.controls.textureLayer.offsetX = value;
        },
        setExpression: (expression) => {
          context.expressions.textureLayer.offsetX = expression;
        },
      });
    }
    case 'texture_offset_y':
    case 'texture_scroll_y': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.textureLayer.offsetY,
        currentExpression: context.expressions.textureLayer.offsetY,
        setValue: (value) => {
          context.controls.textureLayer.offsetY = value;
        },
        setExpression: (expression) => {
          context.expressions.textureLayer.offsetY = expression;
        },
      });
    }
    case 'warp_texture_amount':
    case 'warp_texture_mix': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpTexture.amount,
        currentExpression: context.expressions.warpTexture.amount,
        setValue: (value) => {
          context.controls.warpTexture.amount = value;
        },
        setExpression: (expression) => {
          context.expressions.warpTexture.amount = expression;
        },
      });
    }
    case 'warp_texture_scale':
    case 'warp_texture_scale_x': {
      const applied = applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpTexture.scaleX,
        currentExpression: context.expressions.warpTexture.scaleX,
        setValue: (value) => {
          context.controls.warpTexture.scaleX = value;
        },
        setExpression: (expression) => {
          context.expressions.warpTexture.scaleX = expression;
        },
      });
      if (key === 'warp_texture_scale') {
        context.controls.warpTexture.scaleY =
          context.controls.warpTexture.scaleX;
        context.expressions.warpTexture.scaleY =
          context.expressions.warpTexture.scaleX;
      }
      return applied;
    }
    case 'warp_texture_scale_y': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpTexture.scaleY,
        currentExpression: context.expressions.warpTexture.scaleY,
        setValue: (value) => {
          context.controls.warpTexture.scaleY = value;
        },
        setExpression: (expression) => {
          context.expressions.warpTexture.scaleY = expression;
        },
      });
    }
    case 'warp_texture_offset_x':
    case 'warp_texture_scroll_x': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpTexture.offsetX,
        currentExpression: context.expressions.warpTexture.offsetX,
        setValue: (value) => {
          context.controls.warpTexture.offsetX = value;
        },
        setExpression: (expression) => {
          context.expressions.warpTexture.offsetX = expression;
        },
      });
    }
    case 'warp_texture_offset_y':
    case 'warp_texture_scroll_y': {
      return applyScalarAssignment(context, {
        operator,
        numeric,
        currentValue: context.controls.warpTexture.offsetY,
        currentExpression: context.expressions.warpTexture.offsetY,
        setValue: (value) => {
          context.controls.warpTexture.offsetY = value;
        },
        setExpression: (expression) => {
          context.expressions.warpTexture.offsetY = expression;
        },
      });
    }
    default:
      return false;
  }
}

export function applyShaderAstControlStatement({
  key,
  operator,
  numeric,
  vec2Result,
  vec3Result,
  rawValue,
  resolvedExpression,
  controls,
  expressions,
  shaderEnv,
}: {
  key: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  numeric: ShaderNumericResult | null;
  vec2Result: {
    values: [number, number];
    expressions: [MilkdropExpressionNode | null, MilkdropExpressionNode | null];
  } | null;
  vec3Result: {
    values: [number, number, number];
    expressions: [
      MilkdropExpressionNode | null,
      MilkdropExpressionNode | null,
      MilkdropExpressionNode | null,
    ];
  } | null;
  rawValue: string;
  resolvedExpression: MilkdropShaderExpressionNode;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
}) {
  const context: ShaderControlApplicationContext = {
    controls,
    expressions,
    shaderEnv,
  };

  if (key === 'texture_source') {
    return applyTextureSourceAssignment({
      target: 'texture_source',
      rawValue,
      resolvedExpression,
      context,
    });
  }

  if (key === 'texture_mode') {
    return applyTextureModeAssignment({
      rawValue,
      resolvedExpression,
      context,
    });
  }

  if (key === 'warp_texture_source') {
    return applyTextureSourceAssignment({
      target: 'warp_texture_source',
      rawValue,
      resolvedExpression,
      context,
    });
  }

  if (key === 'uv') {
    if ((operator === '+=' || operator === '-=') && vec2Result) {
      const sign = operator === '-=' ? -1 : 1;
      const nextX = applyNumericControlValue({
        operator: '=',
        numeric: {
          value: vec2Result.values[0] * sign,
          expression: vec2Result.expressions[0] ?? null,
        },
        currentValue: context.controls.offsetX,
        currentExpression: context.expressions.offsetX,
      });
      const nextY = applyNumericControlValue({
        operator: '=',
        numeric: {
          value: vec2Result.values[1] * sign,
          expression: vec2Result.expressions[1] ?? null,
        },
        currentValue: context.controls.offsetY,
        currentExpression: context.expressions.offsetY,
      });
      context.controls.offsetX = nextX.value;
      context.controls.offsetY = nextY.value;
      context.expressions.offsetX = nextX.expression;
      context.expressions.offsetY = nextY.expression;
      context.shaderEnv.offset_x = nextX.value;
      context.shaderEnv.offset_y = nextY.value;
      context.shaderEnv.dx = nextX.value;
      context.shaderEnv.dy = nextY.value;
      return true;
    }
  }

  if (key === 'tint' && vec3Result) {
    const nextR = applyNumericControlValue({
      operator,
      numeric: {
        value: vec3Result.values[0],
        expression: vec3Result.expressions[0] ?? null,
      },
      currentValue: context.controls.tint.r,
      currentExpression: context.expressions.tint.r,
    });
    const nextG = applyNumericControlValue({
      operator,
      numeric: {
        value: vec3Result.values[1],
        expression: vec3Result.expressions[1] ?? null,
      },
      currentValue: context.controls.tint.g,
      currentExpression: context.expressions.tint.g,
    });
    const nextB = applyNumericControlValue({
      operator,
      numeric: {
        value: vec3Result.values[2],
        expression: vec3Result.expressions[2] ?? null,
      },
      currentValue: context.controls.tint.b,
      currentExpression: context.expressions.tint.b,
    });
    context.controls.tint = {
      r: nextR.value,
      g: nextG.value,
      b: nextB.value,
    };
    context.expressions.tint = {
      r: nextR.expression,
      g: nextG.expression,
      b: nextB.expression,
    };
    context.shaderEnv.tint_r = nextR.value;
    context.shaderEnv.tint_g = nextG.value;
    context.shaderEnv.tint_b = nextB.value;
    return true;
  }

  if (key === 'texture_offset' || key === 'texture_scroll') {
    if (vec2Result) {
      const nextX = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[0],
          expression: vec2Result.expressions[0] ?? null,
        },
        currentValue: context.controls.textureLayer.offsetX,
        currentExpression: context.expressions.textureLayer.offsetX,
      });
      const nextY = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[1],
          expression: vec2Result.expressions[1] ?? null,
        },
        currentValue: context.controls.textureLayer.offsetY,
        currentExpression: context.expressions.textureLayer.offsetY,
      });
      context.controls.textureLayer.offsetX = nextX.value;
      context.controls.textureLayer.offsetY = nextY.value;
      context.expressions.textureLayer.offsetX = nextX.expression;
      context.expressions.textureLayer.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'texture_scale') {
    if (vec2Result) {
      const nextX = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[0],
          expression: vec2Result.expressions[0] ?? null,
        },
        currentValue: context.controls.textureLayer.scaleX,
        currentExpression: context.expressions.textureLayer.scaleX,
      });
      const nextY = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[1],
          expression: vec2Result.expressions[1] ?? null,
        },
        currentValue: context.controls.textureLayer.scaleY,
        currentExpression: context.expressions.textureLayer.scaleY,
      });
      context.controls.textureLayer.scaleX = nextX.value;
      context.controls.textureLayer.scaleY = nextY.value;
      context.expressions.textureLayer.scaleX = nextX.expression;
      context.expressions.textureLayer.scaleY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_offset' || key === 'warp_texture_scroll') {
    if (vec2Result) {
      const nextX = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[0],
          expression: vec2Result.expressions[0] ?? null,
        },
        currentValue: context.controls.warpTexture.offsetX,
        currentExpression: context.expressions.warpTexture.offsetX,
      });
      const nextY = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[1],
          expression: vec2Result.expressions[1] ?? null,
        },
        currentValue: context.controls.warpTexture.offsetY,
        currentExpression: context.expressions.warpTexture.offsetY,
      });
      context.controls.warpTexture.offsetX = nextX.value;
      context.controls.warpTexture.offsetY = nextY.value;
      context.expressions.warpTexture.offsetX = nextX.expression;
      context.expressions.warpTexture.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_scale') {
    if (vec2Result) {
      const nextX = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[0],
          expression: vec2Result.expressions[0] ?? null,
        },
        currentValue: context.controls.warpTexture.scaleX,
        currentExpression: context.expressions.warpTexture.scaleX,
      });
      const nextY = applyNumericControlValue({
        operator,
        numeric: {
          value: vec2Result.values[1],
          expression: vec2Result.expressions[1] ?? null,
        },
        currentValue: context.controls.warpTexture.scaleY,
        currentExpression: context.expressions.warpTexture.scaleY,
      });
      context.controls.warpTexture.scaleX = nextX.value;
      context.controls.warpTexture.scaleY = nextY.value;
      context.expressions.warpTexture.scaleX = nextX.expression;
      context.expressions.warpTexture.scaleY = nextY.expression;
      return true;
    }
  }

  if (numeric) {
    return applyShaderScalarAliasControl(context, key, operator, numeric);
  }

  return false;
}

export function applyShaderHeuristicControlStatement({
  key,
  operator,
  rawValue,
  numeric,
  controls,
  expressions,
  shaderEnv,
}: {
  key: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  rawValue: string;
  numeric: ShaderNumericResult | null;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
}) {
  const context: ShaderControlApplicationContext = {
    controls,
    expressions,
    shaderEnv,
  };

  if (key === 'shader_body' && rawValue === 'tex2d(sampler_main,uv).rgb') {
    return true;
  }

  if (key === 'uv') {
    const uvOffsetMatch = rawValue.replace(/\s+/gu, '');
    const offsetMatch = uvOffsetMatch.match(/^uv([+-])vec2\((.+),(.+)\)$/u);
    if (
      operator === '+=' ||
      operator === '-=' ||
      (operator === '=' && offsetMatch)
    ) {
      return false;
    }
  }

  if (key === 'texture_source' || key === 'warp_texture_source') {
    const source = parseShaderSamplerSource(rawValue);
    if (source && isAuxShaderSamplerName(source)) {
      if (key === 'texture_source') {
        context.controls.textureLayer.source = source;
        if (context.controls.textureLayer.mode === 'none') {
          context.controls.textureLayer.mode = 'mix';
        }
      } else {
        context.controls.warpTexture.source = source;
      }
      return true;
    }
    return false;
  }

  if (key === 'texture_mode') {
    const mode = parseShaderTextureBlendMode(rawValue);
    if (mode) {
      context.controls.textureLayer.mode = mode;
      return true;
    }
    return false;
  }

  if (
    numeric &&
    applyShaderScalarAliasControl(context, key, operator, numeric)
  ) {
    return true;
  }

  return false;
}
