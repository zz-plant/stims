import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
} from '../expression';
import { evaluateMilkdropShaderExpression } from '../shader-ast';
import { normalizeMilkdropShaderCallName } from '../shader-expression-shared.ts';
import {
  isMilkdropShaderSamplerName,
  isMilkdropVolumeShaderSamplerName,
  normalizeMilkdropShaderSamplerName,
} from '../shader-samplers';
import type {
  MilkdropExpressionNode,
  MilkdropExtractedShaderSampleMetadata,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
  MilkdropShaderSampleDimension,
  MilkdropShaderTextureBlendMode,
  MilkdropShaderTextureSampler,
} from '../types';
import { DEFAULT_MILKDROP_STATE } from './default-state';

const SHADER_TEXTURE_BLEND_MODES = new Set([
  'none',
  'replace',
  'mix',
  'add',
  'multiply',
]);

export function createDefaultShaderControls(): MilkdropShaderControls {
  return {
    warpScale: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    zoom: 1,
    saturation: 1,
    contrast: 1,
    colorScale: { r: 1, g: 1, b: 1 },
    hueShift: 0,
    mixAlpha: 0,
    brightenBoost: 0,
    invertBoost: 0,
    solarizeBoost: 0,
    tint: { r: 1, g: 1, b: 1 },
    textureLayer: {
      source: 'none',
      mode: 'none',
      sampleDimension: '2d',
      inverted: false,
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
    warpTexture: {
      source: 'none',
      sampleDimension: '2d',
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
  };
}

export function createDefaultShaderControlExpressions(): MilkdropShaderControlExpressions {
  return {
    warpScale: null,
    offsetX: null,
    offsetY: null,
    rotation: null,
    zoom: null,
    saturation: null,
    contrast: null,
    colorScale: { r: null, g: null, b: null },
    hueShift: null,
    mixAlpha: null,
    brightenBoost: null,
    invertBoost: null,
    solarizeBoost: null,
    tint: { r: null, g: null, b: null },
    textureLayer: {
      sampleDimension: '2d',
      amount: null,
      scaleX: null,
      scaleY: null,
      offsetX: null,
      offsetY: null,
      volumeSliceZ: null,
    },
    warpTexture: {
      sampleDimension: '2d',
      amount: null,
      scaleX: null,
      scaleY: null,
      offsetX: null,
      offsetY: null,
      volumeSliceZ: null,
    },
  };
}

type ShaderRuntimeValue = Exclude<
  ReturnType<typeof evaluateMilkdropShaderExpression>,
  null
>;
export type ShaderRuntimeEnv = Record<string, ShaderRuntimeValue>;
export type ShaderExpressionEnv = Record<string, MilkdropShaderExpressionNode>;

export function isShaderScalarValue(
  value: ReturnType<typeof evaluateMilkdropShaderExpression>,
): value is Extract<ShaderRuntimeValue, { kind: 'scalar' }> {
  return value?.kind === 'scalar';
}

export function normalizeShaderCallName(value: string) {
  return normalizeMilkdropShaderCallName(value);
}

export function normalizeShaderSyntax(value: string) {
  return value
    .trim()
    .replace(/texture2d/giu, 'tex2d')
    .replace(/texture3d/giu, 'tex3d')
    .replace(/\btexture(?=\()/giu, 'tex2d')
    .replace(/\bfloat2(?=\()/giu, 'vec2')
    .replace(/\bfloat3(?=\()/giu, 'vec3');
}

export function resolveShaderExpressionIdentifiers(
  node: MilkdropShaderExpressionNode,
  env: ShaderExpressionEnv,
  visited = new Set<string>(),
): MilkdropShaderExpressionNode {
  switch (node.type) {
    case 'identifier': {
      const key = node.name.toLowerCase();
      const resolved = env[key];
      if (!resolved || visited.has(key)) {
        return {
          ...node,
          name: key,
        };
      }
      const nextVisited = new Set(visited);
      nextVisited.add(key);
      return resolveShaderExpressionIdentifiers(resolved, env, nextVisited);
    }
    case 'unary':
      return {
        ...node,
        operand: resolveShaderExpressionIdentifiers(node.operand, env, visited),
      };
    case 'binary':
      return {
        ...node,
        left: resolveShaderExpressionIdentifiers(node.left, env, visited),
        right: resolveShaderExpressionIdentifiers(node.right, env, visited),
      };
    case 'call':
      return {
        ...node,
        name: normalizeShaderCallName(node.name),
        args: node.args.map((arg) =>
          resolveShaderExpressionIdentifiers(arg, env, visited),
        ),
      };
    case 'member':
      return {
        ...node,
        property: node.property.toLowerCase(),
        object: resolveShaderExpressionIdentifiers(node.object, env, visited),
      };
    case 'literal':
      return node;
  }
}

export function toMilkdropExpression(
  node: MilkdropShaderExpressionNode,
): MilkdropExpressionNode | null {
  switch (node.type) {
    case 'literal':
      return { type: 'literal', value: node.value };
    case 'identifier':
      return { type: 'identifier', name: node.name.toLowerCase() };
    case 'unary': {
      const operand = toMilkdropExpression(node.operand);
      if (!operand) {
        return null;
      }
      return {
        type: 'unary',
        operator: node.operator,
        operand,
      };
    }
    case 'binary': {
      const left = toMilkdropExpression(node.left);
      const right = toMilkdropExpression(node.right);
      if (!left || !right) {
        return null;
      }
      return {
        type: 'binary',
        operator: node.operator,
        left,
        right,
      };
    }
    case 'call': {
      const name = normalizeShaderCallName(node.name);
      if (
        name === 'vec2' ||
        name === 'vec3' ||
        name === 'tex2d' ||
        name === 'tex3d'
      ) {
        return null;
      }
      const args = node.args
        .map((arg) => toMilkdropExpression(arg))
        .filter((arg): arg is MilkdropExpressionNode => arg !== null);
      if (args.length !== node.args.length) {
        return null;
      }
      return {
        type: 'call',
        name,
        args,
      };
    }
    case 'member':
      return null;
  }
}

export function cloneShaderNode(node: MilkdropShaderExpressionNode) {
  return resolveShaderExpressionIdentifiers(node, {});
}

export function createShaderUnaryNode(
  operator: '+' | '-' | '!',
  operand: MilkdropShaderExpressionNode,
): MilkdropShaderExpressionNode {
  return {
    type: 'unary',
    operator,
    operand: cloneShaderNode(operand),
  };
}

export function createShaderBinaryNode(
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | '&&'
    | '||',
  left: MilkdropShaderExpressionNode,
  right: MilkdropShaderExpressionNode,
): MilkdropShaderExpressionNode {
  return {
    type: 'binary',
    operator,
    left: cloneShaderNode(left),
    right: cloneShaderNode(right),
  };
}

function expandShaderVectorComponents(
  node: MilkdropShaderExpressionNode,
  size: 2 | 3,
  expressionEnv: ShaderExpressionEnv,
): MilkdropShaderExpressionNode[] | null {
  const resolved = resolveShaderExpressionIdentifiers(node, expressionEnv);
  if (resolved.type === 'call') {
    const name = resolved.name.toLowerCase();
    if (name === `vec${size}` && resolved.args.length >= size) {
      return resolved.args.slice(0, size).map((arg) => cloneShaderNode(arg));
    }
  }
  if (resolved.type === 'unary') {
    const operand = expandShaderVectorComponents(
      resolved.operand,
      size,
      expressionEnv,
    );
    if (!operand) {
      return null;
    }
    return operand.map((component) =>
      createShaderUnaryNode(resolved.operator, component),
    );
  }
  if (resolved.type === 'binary') {
    const leftVector = expandShaderVectorComponents(
      resolved.left,
      size,
      expressionEnv,
    );
    const rightVector = expandShaderVectorComponents(
      resolved.right,
      size,
      expressionEnv,
    );
    const leftScalar = toMilkdropExpression(resolved.left)
      ? Array.from({ length: size }, () => cloneShaderNode(resolved.left))
      : null;
    const rightScalar = toMilkdropExpression(resolved.right)
      ? Array.from({ length: size }, () => cloneShaderNode(resolved.right))
      : null;
    const left = leftVector ?? leftScalar;
    const right = rightVector ?? rightScalar;
    if (!left || !right) {
      return null;
    }
    return left.map((component, index) =>
      createShaderBinaryNode(
        resolved.operator,
        component,
        right[index] as MilkdropShaderExpressionNode,
      ),
    );
  }
  return null;
}

export function evaluateShaderScalarResult(
  node: MilkdropShaderExpressionNode,
  valueEnv: ShaderRuntimeEnv,
  scalarEnv: Record<string, number>,
  expressionEnv: ShaderExpressionEnv,
) {
  const resolved = resolveShaderExpressionIdentifiers(node, expressionEnv);
  const value = evaluateMilkdropShaderExpression(resolved, valueEnv, scalarEnv);
  if (!isShaderScalarValue(value)) {
    return null;
  }
  return {
    value: value.value,
    expression: toMilkdropExpression(resolved),
  };
}

export function evaluateShaderVectorResult(
  node: MilkdropShaderExpressionNode,
  size: 2 | 3,
  valueEnv: ShaderRuntimeEnv,
  scalarEnv: Record<string, number>,
  expressionEnv: ShaderExpressionEnv,
) {
  const components = expandShaderVectorComponents(node, size, expressionEnv);
  if (!components) {
    return null;
  }
  const values = components
    .map((component) =>
      evaluateMilkdropShaderExpression(component, valueEnv, scalarEnv),
    )
    .filter((value): value is Extract<ShaderRuntimeValue, { kind: 'scalar' }> =>
      isShaderScalarValue(value),
    );
  if (values.length !== size) {
    return null;
  }
  return {
    values: values.map((value) => value.value),
    expressions: components.map((component) => toMilkdropExpression(component)),
  };
}

export function parseShaderScalar(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const numeric = Number(rawValue);
  if (Number.isFinite(numeric)) {
    return {
      value: numeric,
      expression: null,
    };
  }

  const expressionResult = parseMilkdropExpression(rawValue, 1);
  if (!expressionResult.value) {
    return null;
  }

  return {
    value: evaluateMilkdropExpression(expressionResult.value, env),
    expression: expressionResult.value,
  };
}

export function splitShaderListValues(rawValue: string) {
  if (rawValue.includes(',')) {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < rawValue.length; index += 1) {
      const char = rawValue[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth = Math.max(depth - 1, 0);
      } else if (char === ',' && depth === 0) {
        values.push(rawValue.slice(start, index).trim());
        start = index + 1;
      }
    }

    values.push(rawValue.slice(start).trim());
    return values.filter(Boolean);
  }

  return rawValue
    .trim()
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseShaderTintList(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const components = splitShaderListValues(rawValue)
    .slice(0, 3)
    .map((entry) => parseShaderScalar(entry, env));
  if (components.length < 3 || components.some((entry) => entry === null)) {
    return null;
  }
  const values = components as Array<{
    value: number;
    expression: MilkdropExpressionNode | null;
  }>;
  return {
    value: {
      r: Math.min(Math.max(values[0]?.value ?? 1, 0), 2),
      g: Math.min(Math.max(values[1]?.value ?? 1, 0), 2),
      b: Math.min(Math.max(values[2]?.value ?? 1, 0), 2),
    },
    expressions: {
      r: values[0]?.expression ?? null,
      g: values[1]?.expression ?? null,
      b: values[2]?.expression ?? null,
    },
  };
}

export function parseShaderVec2List(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const components = splitShaderListValues(rawValue)
    .slice(0, 2)
    .map((entry) => parseShaderScalar(entry, env));
  if (components.length < 2 || components.some((entry) => entry === null)) {
    return null;
  }
  const values = components as Array<{
    value: number;
    expression: MilkdropExpressionNode | null;
  }>;
  return {
    value: {
      x: values[0]?.value ?? 0,
      y: values[1]?.value ?? 0,
    },
    expressions: {
      x: values[0]?.expression ?? null,
      y: values[1]?.expression ?? null,
    },
  };
}

export function parseShaderVec2Constructor(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec2\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderVec2List(match[1] ?? '', env);
}

export function createLiteralExpression(value: number): MilkdropExpressionNode {
  return {
    type: 'literal',
    value,
  };
}

export function applyShaderExpressionOperator(
  operator: '=' | '+=' | '-=' | '*=' | '/=',
  currentValue: number,
  currentExpression: MilkdropExpressionNode | null,
  nextValue: number,
  nextExpression: MilkdropExpressionNode | null,
) {
  if (operator === '=') {
    return {
      value: nextValue,
      expression: nextExpression,
    };
  }

  const leftExpression =
    currentExpression ?? createLiteralExpression(currentValue);
  const rightExpression = nextExpression ?? createLiteralExpression(nextValue);
  const binaryOperator =
    operator === '+='
      ? '+'
      : operator === '-='
        ? '-'
        : operator === '*='
          ? '*'
          : '/';

  return {
    value:
      operator === '+='
        ? currentValue + nextValue
        : operator === '-='
          ? currentValue - nextValue
          : operator === '*='
            ? currentValue * nextValue
            : nextValue === 0
              ? 0
              : currentValue / nextValue,
    expression: {
      type: 'binary',
      operator: binaryOperator,
      left: leftExpression,
      right: rightExpression,
    } satisfies MilkdropExpressionNode,
  };
}

export function applyShaderControlValue(
  operator: '=' | '+=' | '-=' | '*=' | '/=',
  currentValue: number,
  currentExpression: MilkdropExpressionNode | null,
  nextValue: number,
  nextExpression: MilkdropExpressionNode | null,
) {
  return applyShaderExpressionOperator(
    operator,
    currentValue,
    currentExpression,
    nextValue,
    nextExpression,
  );
}

export function parseShaderVec3Constructor(
  rawValue: string,
  env: Record<string, number>,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec3\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderTintList(match[1] ?? '', env);
}

export function parseShaderSampleMixPattern(rawValue: string) {
  const normalized = normalizeShaderSyntax(rawValue);
  const match = normalized.match(/^mix\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  const parts = splitShaderListValues(match[1] ?? '');
  if (parts.length !== 3) {
    return null;
  }
  return {
    left: (parts[0] ?? '').replace(/\s+/gu, '').toLowerCase(),
    right: (parts[1] ?? '').replace(/\s+/gu, '').toLowerCase(),
    amount: parts[2] ?? '',
  };
}

export function normalizeShaderSamplerName(
  value: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeMilkdropShaderSamplerName(value);
}

export function normalizeShaderTextureBlendMode(
  value: string,
): MilkdropShaderTextureBlendMode | null {
  const normalized = value.trim().toLowerCase();
  return SHADER_TEXTURE_BLEND_MODES.has(normalized)
    ? (normalized as MilkdropShaderTextureBlendMode)
    : null;
}

export function parseShaderSamplerSource(
  rawValue: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeShaderSamplerName(rawValue.replace(/[;,\s]+$/gu, ''));
}

export function parseShaderTextureBlendMode(
  rawValue: string,
): MilkdropShaderTextureBlendMode | null {
  return normalizeShaderTextureBlendMode(rawValue.replace(/[;,\s]+$/gu, ''));
}

export function isAuxShaderSamplerName(
  value: string,
): value is MilkdropShaderTextureSampler {
  return value !== 'main' && isMilkdropShaderSamplerName(value);
}

export function buildUnsupportedVolumeSamplerWarnings(
  controls: Pick<MilkdropShaderControls, 'textureLayer' | 'warpTexture'>,
) {
  const warnings: string[] = [];
  const appendWarning = (
    controlName: 'textureLayer' | 'warpTexture',
    label: string,
    source: MilkdropShaderTextureSampler,
  ) => {
    if (
      controls[controlName].sampleDimension !== '3d' ||
      source === 'none' ||
      isMilkdropVolumeShaderSamplerName(source)
    ) {
      return;
    }
    warnings.push(
      `${label} uses tex3D/texture3D with aux sampler "${source}", but only "simplex" is backed by the runtime volume atlas; this lookup will be approximated from a 2D texture.`,
    );
  };

  appendWarning(
    'textureLayer',
    'Texture layer shader control',
    controls.textureLayer.source,
  );
  appendWarning(
    'warpTexture',
    'Warp texture shader control',
    controls.warpTexture.source,
  );

  return warnings;
}

export function isKnownShaderScalarKey(key: string) {
  return new Set([
    'warp',
    'warp_scale',
    'dx',
    'offset_x',
    'translate_x',
    'dy',
    'offset_y',
    'translate_y',
    'rot',
    'rotation',
    'zoom',
    'scale',
    'saturation',
    'sat',
    'contrast',
    'r',
    'red',
    'g',
    'green',
    'b',
    'blue',
    'hue',
    'hue_shift',
    'mix',
    'feedback',
    'feedback_alpha',
    'brighten',
    'invert',
    'solarize',
    'texture_amount',
    'texture_mix',
    'texture_scale',
    'texture_scale_x',
    'texture_scale_y',
    'texture_offset_x',
    'texture_offset_y',
    'texture_scroll_x',
    'texture_scroll_y',
    'warp_texture_amount',
    'warp_texture_mix',
    'warp_texture_scale',
    'warp_texture_scale_x',
    'warp_texture_scale_y',
    'warp_texture_offset_x',
    'warp_texture_offset_y',
    'warp_texture_scroll_x',
    'warp_texture_scroll_y',
  ]).has(key);
}

export function isIdentityTextureSampleExpression(rawValue: string) {
  const normalized = normalizeShaderSyntax(rawValue)
    .toLowerCase()
    .replace(/\s+/gu, '');
  return normalized === 'tex2d(sampler_main,uv).rgb';
}

export function isShaderLiteralNumber(
  node: MilkdropShaderExpressionNode,
  value: number,
) {
  return node.type === 'literal' && Math.abs(node.value - value) < 0.000_001;
}

export function isShaderSampleRgbExpression(
  node: MilkdropShaderExpressionNode,
): boolean {
  return (
    node.type === 'member' &&
    ['rgb', 'xyz'].includes(node.property.toLowerCase()) &&
    node.object.type === 'call' &&
    ['tex2d', 'tex3d'].includes(normalizeShaderCallName(node.object.name)) &&
    node.object.args.length >= 2
  );
}

function splitShaderSampleCoordinate(
  name: 'tex2d' | 'tex3d',
  coordinate: MilkdropShaderExpressionNode,
): {
  dimension: MilkdropShaderSampleDimension;
  uv: MilkdropShaderExpressionNode;
  z: MilkdropShaderExpressionNode | null;
} | null {
  if (name === 'tex2d') {
    return {
      dimension: '2d',
      uv: coordinate,
      z: null,
    };
  }

  if (
    coordinate.type === 'call' &&
    normalizeShaderCallName(coordinate.name) === 'vec3'
  ) {
    if (coordinate.args.length >= 2) {
      return {
        dimension: '3d',
        uv: coordinate.args[0] as MilkdropShaderExpressionNode,
        z: coordinate.args[1] as MilkdropShaderExpressionNode,
      };
    }

    if (coordinate.args.length >= 3) {
      const [x, y, z] = coordinate.args;
      if (x && y && z) {
        return {
          dimension: '3d',
          uv: {
            type: 'call',
            name: 'vec2',
            args: [x, y],
          },
          z,
        };
      }
    }
  }

  return null;
}

export function getShaderSampleInfo(
  node: MilkdropShaderExpressionNode,
): MilkdropExtractedShaderSampleMetadata | null {
  if (
    node.type !== 'member' ||
    !['rgb', 'xyz'].includes(node.property.toLowerCase()) ||
    node.object.type !== 'call' ||
    !['tex2d', 'tex3d'].includes(normalizeShaderCallName(node.object.name)) ||
    node.object.args.length < 2
  ) {
    return null;
  }
  const samplerArg = node.object.args[0];
  const coordinateArg = node.object.args[1];
  if (!samplerArg || !coordinateArg) {
    return null;
  }
  const callName = normalizeShaderCallName(node.object.name) as
    | 'tex2d'
    | 'tex3d';
  const coordinate = splitShaderSampleCoordinate(callName, coordinateArg);
  if (!coordinate) {
    return null;
  }
  const source =
    samplerArg.type === 'identifier'
      ? normalizeShaderSamplerName(samplerArg.name)
      : 'main';
  if (!source) {
    return null;
  }
  return {
    source,
    sampleDimension: coordinate.dimension,
    uv: coordinate.uv,
    volumeSliceZ: coordinate.z,
  };
}

export function isShaderMainSampleExpression(
  node: MilkdropShaderExpressionNode,
) {
  return getShaderSampleInfo(node)?.source === 'main';
}

function isShaderAuxSampleExpression(node: MilkdropShaderExpressionNode) {
  const source = getShaderSampleInfo(node)?.source;
  return Boolean(source && source !== 'main' && source !== 'none');
}

export function isUnsupportedVolumeSampleSource(
  source: string | null | undefined,
) {
  if (!source || source === 'main' || source === 'none') {
    return source !== 'none';
  }
  return !isMilkdropVolumeShaderSamplerName(source);
}

export function hasUnsupportedVolumeSample(
  node: MilkdropShaderExpressionNode | null,
): boolean {
  if (!node) {
    return false;
  }

  switch (node.type) {
    case 'literal':
    case 'identifier':
      return false;
    case 'unary':
      return hasUnsupportedVolumeSample(node.operand);
    case 'binary':
      return (
        hasUnsupportedVolumeSample(node.left) ||
        hasUnsupportedVolumeSample(node.right)
      );
    case 'member':
      return hasUnsupportedVolumeSample(node.object);
    case 'call': {
      const callName = normalizeShaderCallName(node.name);
      if (callName === 'tex3d') {
        const samplerArg = node.args[0];
        const source =
          samplerArg?.type === 'identifier'
            ? normalizeShaderSamplerName(samplerArg.name)
            : 'main';
        if (!source || isUnsupportedVolumeSampleSource(source)) {
          return true;
        }
      }
      return node.args.some((arg) => hasUnsupportedVolumeSample(arg));
    }
    default:
      return false;
  }
}

export function extractScaledShaderSampleExpression(
  node: MilkdropShaderExpressionNode,
): {
  amountExpression: MilkdropExpressionNode | null;
  amountValue: number;
  sample: MilkdropExtractedShaderSampleMetadata;
} | null {
  const directSample = getShaderSampleInfo(node);
  if (
    directSample &&
    directSample.source !== 'main' &&
    directSample.source !== 'none'
  ) {
    return {
      amountExpression: createLiteralExpression(1),
      amountValue: 1,
      sample: directSample,
    };
  }

  if (
    node.type !== 'binary' ||
    node.operator !== '*' ||
    (!isShaderAuxSampleExpression(node.left) &&
      !isShaderAuxSampleExpression(node.right))
  ) {
    return null;
  }

  const sampleNode = isShaderAuxSampleExpression(node.left)
    ? node.left
    : node.right;
  const amountNode = sampleNode === node.left ? node.right : node.left;
  const sample = getShaderSampleInfo(sampleNode);
  if (!sample || sample.source === 'main' || sample.source === 'none') {
    return null;
  }

  const scalarExpression = toMilkdropExpression(amountNode);
  if (!scalarExpression) {
    return null;
  }

  return {
    amountExpression: scalarExpression,
    amountValue: evaluateMilkdropExpression(
      scalarExpression,
      DEFAULT_MILKDROP_STATE,
    ),
    sample,
  };
}

function analyzeShaderUvTransform(node: MilkdropShaderExpressionNode): {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  expressions: {
    scaleX: MilkdropExpressionNode | null;
    scaleY: MilkdropExpressionNode | null;
    offsetX: MilkdropExpressionNode | null;
    offsetY: MilkdropExpressionNode | null;
  };
} | null {
  if (isShaderUvIdentifier(node)) {
    return {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      expressions: {
        scaleX: null,
        scaleY: null,
        offsetX: null,
        offsetY: null,
      },
    };
  }

  if (
    node.type === 'binary' &&
    (node.operator === '+' || node.operator === '-')
  ) {
    const base = analyzeShaderUvTransform(node.left);
    const offset = evaluateShaderVectorResult(
      node.right,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!base || !offset) {
      return null;
    }
    const sign = node.operator === '-' ? -1 : 1;
    return {
      scaleX: base.scaleX,
      scaleY: base.scaleY,
      offsetX: base.offsetX + offset.values[0] * sign,
      offsetY: base.offsetY + offset.values[1] * sign,
      expressions: {
        scaleX: base.expressions.scaleX,
        scaleY: base.expressions.scaleY,
        offsetX:
          offset.expressions[0] && sign === -1
            ? {
                type: 'unary',
                operator: '-',
                operand: offset.expressions[0],
              }
            : (offset.expressions[0] ?? base.expressions.offsetX),
        offsetY:
          offset.expressions[1] && sign === -1
            ? {
                type: 'unary',
                operator: '-',
                operand: offset.expressions[1],
              }
            : (offset.expressions[1] ?? base.expressions.offsetY),
      },
    };
  }

  if (node.type === 'binary' && node.operator === '*') {
    const uvSide = isShaderUvIdentifier(node.left)
      ? node.left
      : isShaderUvIdentifier(node.right)
        ? node.right
        : null;
    const scaleSide =
      uvSide === node.left
        ? node.right
        : uvSide === node.right
          ? node.left
          : null;
    if (!uvSide || !scaleSide) {
      return null;
    }

    const scalar = evaluateShaderScalarResult(
      scaleSide,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (scalar) {
      return {
        scaleX: scalar.value,
        scaleY: scalar.value,
        offsetX: 0,
        offsetY: 0,
        expressions: {
          scaleX: scalar.expression,
          scaleY: scalar.expression,
          offsetX: null,
          offsetY: null,
        },
      };
    }

    const vector = evaluateShaderVectorResult(
      scaleSide,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!vector) {
      return null;
    }
    return {
      scaleX: vector.values[0],
      scaleY: vector.values[1],
      offsetX: 0,
      offsetY: 0,
      expressions: {
        scaleX: vector.expressions[0] ?? null,
        scaleY: vector.expressions[1] ?? null,
        offsetX: null,
        offsetY: null,
      },
    };
  }

  if (
    node.type === 'binary' &&
    node.operator === '+' &&
    node.left.type === 'binary' &&
    node.left.operator === '*'
  ) {
    const scaled = analyzeShaderUvTransform(node.left);
    const offset = evaluateShaderVectorResult(
      node.right,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!scaled || !offset) {
      return null;
    }
    return {
      scaleX: scaled.scaleX,
      scaleY: scaled.scaleY,
      offsetX: offset.values[0],
      offsetY: offset.values[1],
      expressions: {
        scaleX: scaled.expressions.scaleX,
        scaleY: scaled.expressions.scaleY,
        offsetX: offset.expressions[0] ?? null,
        offsetY: offset.expressions[1] ?? null,
      },
    };
  }

  return null;
}

function analyzeShaderVolumeSlice(node: MilkdropShaderExpressionNode | null): {
  value: number | null;
  expression: MilkdropExpressionNode | null;
} {
  if (!node) {
    return {
      value: null,
      expression: null,
    };
  }

  const scalar = evaluateShaderScalarResult(
    node,
    { uv: { kind: 'vec2', value: [0, 0] } },
    DEFAULT_MILKDROP_STATE,
    {},
  );
  return {
    value: scalar?.value ?? null,
    expression: scalar?.expression ?? null,
  };
}

function analyzeShaderSampleCoordinate(
  sample: MilkdropExtractedShaderSampleMetadata,
) {
  return {
    uv: analyzeShaderUvTransform(sample.uv),
    volumeSlice: analyzeShaderVolumeSlice(sample.volumeSliceZ),
  };
}

export function applyTextureLayerSample(
  controls: MilkdropShaderControls,
  expressions: MilkdropShaderControlExpressions,
  sample: MilkdropExtractedShaderSampleMetadata,
  options: { inverted?: boolean } = {},
) {
  const coordinate = analyzeShaderSampleCoordinate(sample);
  controls.textureLayer.source = sample.source as MilkdropShaderTextureSampler;
  controls.textureLayer.sampleDimension = sample.sampleDimension;
  controls.textureLayer.inverted = options.inverted ?? false;
  controls.textureLayer.volumeSliceZ = coordinate.volumeSlice.value;
  expressions.textureLayer.sampleDimension = sample.sampleDimension;
  expressions.textureLayer.volumeSliceZ = coordinate.volumeSlice.expression;
  if (coordinate.uv) {
    controls.textureLayer.scaleX = coordinate.uv.scaleX;
    controls.textureLayer.scaleY = coordinate.uv.scaleY;
    controls.textureLayer.offsetX = coordinate.uv.offsetX;
    controls.textureLayer.offsetY = coordinate.uv.offsetY;
    expressions.textureLayer.scaleX = coordinate.uv.expressions.scaleX;
    expressions.textureLayer.scaleY = coordinate.uv.expressions.scaleY;
    expressions.textureLayer.offsetX = coordinate.uv.expressions.offsetX;
    expressions.textureLayer.offsetY = coordinate.uv.expressions.offsetY;
  }
}

export function isShaderUvIdentifier(node: MilkdropShaderExpressionNode) {
  return node.type === 'identifier' && node.name.toLowerCase() === 'uv';
}

export function extractShaderInvertedSampleExpression(
  node: MilkdropShaderExpressionNode,
): MilkdropExtractedShaderSampleMetadata | 'main' | null {
  if (
    node.type !== 'binary' ||
    node.operator !== '-' ||
    !isShaderLiteralNumber(node.left, 1)
  ) {
    return null;
  }

  const sample = getShaderSampleInfo(node.right);
  if (!sample) {
    return null;
  }

  return sample.source === 'main' ? 'main' : sample;
}

export function isShaderSolarizeSampleExpression(
  node: MilkdropShaderExpressionNode,
): boolean {
  if (
    node.type !== 'binary' ||
    node.operator !== '*' ||
    !isShaderLiteralNumber(node.right, 1.5)
  ) {
    return false;
  }
  const absCall = node.left;
  if (
    absCall.type !== 'call' ||
    absCall.name.toLowerCase() !== 'abs' ||
    absCall.args.length < 1
  ) {
    return false;
  }
  const arg = absCall.args[0];
  if (arg?.type !== 'binary' || arg.operator !== '-') {
    return false;
  }
  const right = arg.right;
  const centeredSample =
    isShaderMainSampleExpression(arg.left) &&
    (isShaderLiteralNumber(right, 0.5) ||
      (right?.type === 'call' &&
        normalizeShaderCallName(right.name) === 'vec3' &&
        right.args.length >= 1 &&
        right.args.every((entry) => isShaderLiteralNumber(entry, 0.5))));
  return centeredSample;
}

export function buildTintBlendExpression(
  tintExpression: MilkdropExpressionNode | null,
  amountExpression: MilkdropExpressionNode | null,
) {
  if (!tintExpression || !amountExpression) {
    return tintExpression;
  }
  return {
    type: 'binary',
    operator: '+',
    left: createLiteralExpression(1),
    right: {
      type: 'binary',
      operator: '*',
      left: {
        type: 'binary',
        operator: '-',
        left: tintExpression,
        right: createLiteralExpression(1),
      },
      right: amountExpression,
    },
  } satisfies MilkdropExpressionNode;
}
