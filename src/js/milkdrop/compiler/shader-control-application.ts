import type {
  MilkdropExpressionNode,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
} from '../types';
import {
  applyShaderExpressionOperator,
  isAuxShaderSamplerName,
  MILKDROP_SHADER_SCALAR_ALIASES,
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
  if (!source) {
    return false;
  }
  // Explicitly setting source back to main resets the overlay layer to none
  if (source === 'main') {
    if (target === 'texture_source') {
      context.controls.textureLayer.source = 'none';
      context.controls.textureLayer.mode = 'none';
    } else {
      context.controls.warpTexture.source = 'none';
    }
    return true;
  }
  if (!isAuxShaderSamplerName(source)) {
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
  const descriptor = MILKDROP_SHADER_SCALAR_ALIASES[key];
  if (!descriptor) {
    return false;
  }
  const controlRef = resolveControlPath(context.controls, descriptor.target);
  const expressionRef = resolveExpressionPath(
    context.expressions,
    descriptor.target,
  );
  const applied = applyScalarAssignment(context, {
    operator,
    numeric,
    currentValue: controlRef.value,
    currentExpression: expressionRef.value,
    setValue: (value) => {
      controlRef.set(value);
    },
    setExpression: (expression) => {
      expressionRef.set(expression);
    },
    envKeys: descriptor.envKeys,
  });
  if (descriptor.mirrorY) {
    context.controls.textureLayer.scaleY = context.controls.textureLayer.scaleX;
    context.expressions.textureLayer.scaleY =
      context.expressions.textureLayer.scaleX;
  }
  return applied;
}

type MutableControlContainer = {
  warpScale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  zoom: number;
  saturation: number;
  contrast: number;
  colorScale: { r: number; g: number; b: number };
  hueShift: number;
  mixAlpha: number;
  brightenBoost: number;
  invertBoost: number;
  solarizeBoost: number;
  textureLayer: {
    amount: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
  warpTexture: {
    amount: number;
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
};

function resolveControlPath(
  controls: MutableControlContainer,
  path: string,
): { value: number; set: (value: number) => void } {
  const parts = path.split('.');
  let container: Record<string, unknown> = controls;
  for (let i = 0; i < parts.length - 1; i += 1) {
    container = container[parts[i]] as Record<string, unknown>;
  }
  const leaf = parts.at(-1) ?? '';
  return {
    value: container[leaf] as number,
    set: (value) => {
      container[leaf] = value;
    },
  };
}

type MutableExpressionContainer = {
  warpScale: MilkdropExpressionNode | null;
  offsetX: MilkdropExpressionNode | null;
  offsetY: MilkdropExpressionNode | null;
  rotation: MilkdropExpressionNode | null;
  zoom: MilkdropExpressionNode | null;
  saturation: MilkdropExpressionNode | null;
  contrast: MilkdropExpressionNode | null;
  colorScale: {
    r: MilkdropExpressionNode | null;
    g: MilkdropExpressionNode | null;
    b: MilkdropExpressionNode | null;
  };
  hueShift: MilkdropExpressionNode | null;
  mixAlpha: MilkdropExpressionNode | null;
  brightenBoost: MilkdropExpressionNode | null;
  invertBoost: MilkdropExpressionNode | null;
  solarizeBoost: MilkdropExpressionNode | null;
  textureLayer: {
    amount: MilkdropExpressionNode | null;
    scaleX: MilkdropExpressionNode | null;
    scaleY: MilkdropExpressionNode | null;
    offsetX: MilkdropExpressionNode | null;
    offsetY: MilkdropExpressionNode | null;
  };
  warpTexture: {
    amount: MilkdropExpressionNode | null;
    scaleX: MilkdropExpressionNode | null;
    scaleY: MilkdropExpressionNode | null;
    offsetX: MilkdropExpressionNode | null;
    offsetY: MilkdropExpressionNode | null;
  };
};

function resolveExpressionPath(
  expressions: MutableExpressionContainer,
  path: string,
): {
  value: MilkdropExpressionNode | null;
  set: (expression: MilkdropExpressionNode | null) => void;
} {
  const parts = path.split('.');
  let container: Record<string, unknown> = expressions;
  for (let i = 0; i < parts.length - 1; i += 1) {
    container = container[parts[i]] as Record<string, unknown>;
  }
  const leaf = parts.at(-1) ?? '';
  return {
    value: container[leaf] as MilkdropExpressionNode | null,
    set: (expression) => {
      container[leaf] = expression;
    },
  };
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
    return applyTextureSourceAssignment({
      target: key,
      rawValue,
      resolvedExpression: null,
      context,
    });
  }

  if (key === 'texture_mode') {
    return applyTextureModeAssignment({
      rawValue,
      resolvedExpression: null,
      context,
    });
  }

  if (
    numeric &&
    applyShaderScalarAliasControl(context, key, operator, numeric)
  ) {
    return true;
  }

  return false;
}
