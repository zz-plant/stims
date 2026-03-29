import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
} from '../expression';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../shader-ast';
import {
  isMilkdropShaderSamplerName,
  isMilkdropVolumeShaderSamplerName,
  normalizeMilkdropShaderSamplerName,
} from '../shader-samplers';
import type {
  MilkdropExpressionNode,
  MilkdropExtractedShaderSampleMetadata,
  MilkdropRenderBackend,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
  MilkdropShaderProgramPayload,
  MilkdropShaderProgramStage,
  MilkdropShaderSampleDimension,
  MilkdropShaderStatement,
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

function createDefaultShaderControls(): MilkdropShaderControls {
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

function createDefaultShaderControlExpressions(): MilkdropShaderControlExpressions {
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
type ShaderRuntimeEnv = Record<string, ShaderRuntimeValue>;
type ShaderExpressionEnv = Record<string, MilkdropShaderExpressionNode>;

function isShaderScalarValue(
  value: ReturnType<typeof evaluateMilkdropShaderExpression>,
): value is Extract<ShaderRuntimeValue, { kind: 'scalar' }> {
  return value?.kind === 'scalar';
}

function normalizeShaderCallName(value: string) {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case 'float2':
      return 'vec2';
    case 'float3':
      return 'vec3';
    case 'texture':
    case 'texture2d':
    case 'tex2d':
      return 'tex2d';
    case 'texture3d':
    case 'tex3d':
      return 'tex3d';
    default:
      return normalized;
  }
}

function normalizeShaderSyntax(value: string) {
  return value
    .trim()
    .replace(/texture2d/giu, 'tex2d')
    .replace(/texture3d/giu, 'tex3d')
    .replace(/\btexture(?=\()/giu, 'tex2d')
    .replace(/\bfloat2(?=\()/giu, 'vec2')
    .replace(/\bfloat3(?=\()/giu, 'vec3');
}

function resolveShaderExpressionIdentifiers(
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

function toMilkdropExpression(
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

function cloneShaderNode(node: MilkdropShaderExpressionNode) {
  return resolveShaderExpressionIdentifiers(node, {});
}

function createShaderUnaryNode(
  operator: '+' | '-' | '!',
  operand: MilkdropShaderExpressionNode,
): MilkdropShaderExpressionNode {
  return {
    type: 'unary',
    operator,
    operand: cloneShaderNode(operand),
  };
}

function createShaderBinaryNode(
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

function evaluateShaderScalarResult(
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

function evaluateShaderVectorResult(
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

function parseShaderScalar(
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

function splitShaderListValues(rawValue: string) {
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

function parseShaderTintList(
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

function parseShaderVec2List(
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

function parseShaderVec2Constructor(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec2\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderVec2List(match[1] ?? '', env);
}

function createLiteralExpression(value: number): MilkdropExpressionNode {
  return {
    type: 'literal',
    value,
  };
}

function applyShaderExpressionOperator(
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

function applyShaderControlValue(
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

function parseShaderVec3Constructor(
  rawValue: string,
  env: Record<string, number>,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec3\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderTintList(match[1] ?? '', env);
}

function parseShaderSampleMixPattern(rawValue: string) {
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

function normalizeShaderSamplerName(
  value: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeMilkdropShaderSamplerName(value);
}

function normalizeShaderTextureBlendMode(
  value: string,
): MilkdropShaderTextureBlendMode | null {
  const normalized = value.trim().toLowerCase();
  return SHADER_TEXTURE_BLEND_MODES.has(normalized)
    ? (normalized as MilkdropShaderTextureBlendMode)
    : null;
}

function parseShaderSamplerSource(
  rawValue: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeShaderSamplerName(rawValue.replace(/[;,\s]+$/gu, ''));
}

function parseShaderTextureBlendMode(
  rawValue: string,
): MilkdropShaderTextureBlendMode | null {
  return normalizeShaderTextureBlendMode(rawValue.replace(/[;,\s]+$/gu, ''));
}

function isAuxShaderSamplerName(
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

function isKnownShaderScalarKey(key: string) {
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

function isIdentityTextureSampleExpression(rawValue: string) {
  const normalized = normalizeShaderSyntax(rawValue)
    .toLowerCase()
    .replace(/\s+/gu, '');
  return normalized === 'tex2d(sampler_main,uv).rgb';
}

function isShaderLiteralNumber(
  node: MilkdropShaderExpressionNode,
  value: number,
) {
  return node.type === 'literal' && Math.abs(node.value - value) < 0.000_001;
}

function isShaderSampleRgbExpression(
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

function getShaderSampleInfo(
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

function isShaderMainSampleExpression(node: MilkdropShaderExpressionNode) {
  return getShaderSampleInfo(node)?.source === 'main';
}

function isShaderAuxSampleExpression(node: MilkdropShaderExpressionNode) {
  const source = getShaderSampleInfo(node)?.source;
  return Boolean(source && source !== 'main' && source !== 'none');
}

function isUnsupportedVolumeSampleSource(source: string | null | undefined) {
  if (!source || source === 'main' || source === 'none') {
    return source !== 'none';
  }
  return !isMilkdropVolumeShaderSamplerName(source);
}

function hasUnsupportedVolumeSample(
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

function extractScaledShaderSampleExpression(
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

function applyTextureLayerSample(
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

function isShaderUvIdentifier(node: MilkdropShaderExpressionNode) {
  return node.type === 'identifier' && node.name.toLowerCase() === 'uv';
}

function extractShaderInvertedSampleExpression(
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

function isShaderSolarizeSampleExpression(
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

function buildTintBlendExpression(
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

  const scalarAliases = {
    warp: ['warp', 'warp_scale'],
    offsetX: ['dx', 'offset_x', 'translate_x'],
    offsetY: ['dy', 'offset_y', 'translate_y'],
    rotation: ['rot', 'rotation'],
    zoom: ['zoom', 'scale'],
    saturation: ['saturation', 'sat'],
    contrast: ['contrast'],
    colorScaleR: ['r', 'red'],
    colorScaleG: ['g', 'green'],
    colorScaleB: ['b', 'blue'],
    hueShift: ['hue', 'hue_shift'],
    mixAlpha: ['mix', 'feedback', 'feedback_alpha'],
    brightenBoost: ['brighten'],
    invertBoost: ['invert'],
    solarizeBoost: ['solarize'],
    textureAmount: ['texture_amount', 'texture_mix'],
    textureScaleX: ['texture_scale', 'texture_scale_x'],
    textureScaleY: ['texture_scale', 'texture_scale_y'],
    textureOffsetX: ['texture_offset_x', 'texture_scroll_x'],
    textureOffsetY: ['texture_offset_y', 'texture_scroll_y'],
    warpTextureAmount: ['warp_texture_amount', 'warp_texture_mix'],
    warpTextureScaleX: ['warp_texture_scale', 'warp_texture_scale_x'],
    warpTextureScaleY: ['warp_texture_scale', 'warp_texture_scale_y'],
    warpTextureOffsetX: ['warp_texture_offset_x', 'warp_texture_scroll_x'],
    warpTextureOffsetY: ['warp_texture_offset_y', 'warp_texture_scroll_y'],
  } as const;
  const matchesAlias = (aliases: readonly string[]) => aliases.includes(key);
  const numeric = scalarResult();
  if (numeric) {
    const updateScalarControl = (
      currentValue: number,
      currentExpression: MilkdropExpressionNode | null,
    ) => {
      return applyShaderExpressionOperator(
        operator,
        currentValue,
        currentExpression,
        numeric.value,
        numeric.expression,
      );
    };

    if (matchesAlias(scalarAliases.warp)) {
      const next = updateScalarControl(
        controls.warpScale,
        expressions.warpScale,
      );
      controls.warpScale = next.value;
      expressions.warpScale = next.expression;
      shaderEnv.warp = next.value;
      shaderEnv.warp_scale = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.offsetX)) {
      const next = updateScalarControl(controls.offsetX, expressions.offsetX);
      controls.offsetX = next.value;
      expressions.offsetX = next.expression;
      shaderEnv.dx = next.value;
      shaderEnv.offset_x = next.value;
      shaderEnv.translate_x = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.offsetY)) {
      const next = updateScalarControl(controls.offsetY, expressions.offsetY);
      controls.offsetY = next.value;
      expressions.offsetY = next.expression;
      shaderEnv.dy = next.value;
      shaderEnv.offset_y = next.value;
      shaderEnv.translate_y = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.rotation)) {
      const next = updateScalarControl(controls.rotation, expressions.rotation);
      controls.rotation = next.value;
      expressions.rotation = next.expression;
      shaderEnv.rot = next.value;
      shaderEnv.rotation = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.zoom)) {
      const next = updateScalarControl(controls.zoom, expressions.zoom);
      controls.zoom = next.value;
      expressions.zoom = next.expression;
      shaderEnv.zoom = next.value;
      shaderEnv.scale = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.saturation)) {
      const next = updateScalarControl(
        controls.saturation,
        expressions.saturation,
      );
      controls.saturation = next.value;
      expressions.saturation = next.expression;
      shaderEnv.saturation = next.value;
      shaderEnv.sat = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.contrast)) {
      const next = updateScalarControl(controls.contrast, expressions.contrast);
      controls.contrast = next.value;
      expressions.contrast = next.expression;
      shaderEnv.contrast = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleR)) {
      const next = updateScalarControl(
        controls.colorScale.r,
        expressions.colorScale.r,
      );
      controls.colorScale.r = next.value;
      expressions.colorScale.r = next.expression;
      shaderEnv.r = next.value;
      shaderEnv.red = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleG)) {
      const next = updateScalarControl(
        controls.colorScale.g,
        expressions.colorScale.g,
      );
      controls.colorScale.g = next.value;
      expressions.colorScale.g = next.expression;
      shaderEnv.g = next.value;
      shaderEnv.green = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleB)) {
      const next = updateScalarControl(
        controls.colorScale.b,
        expressions.colorScale.b,
      );
      controls.colorScale.b = next.value;
      expressions.colorScale.b = next.expression;
      shaderEnv.b = next.value;
      shaderEnv.blue = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.hueShift)) {
      const next = updateScalarControl(controls.hueShift, expressions.hueShift);
      controls.hueShift = next.value;
      expressions.hueShift = next.expression;
      shaderEnv.hue = next.value;
      shaderEnv.hue_shift = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.mixAlpha)) {
      const next = updateScalarControl(controls.mixAlpha, expressions.mixAlpha);
      controls.mixAlpha = next.value;
      expressions.mixAlpha = next.expression;
      shaderEnv.mix = next.value;
      shaderEnv.feedback = next.value;
      shaderEnv.feedback_alpha = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.brightenBoost)) {
      const next = updateScalarControl(
        controls.brightenBoost,
        expressions.brightenBoost,
      );
      controls.brightenBoost = next.value;
      expressions.brightenBoost = next.expression;
      shaderEnv.brighten = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.invertBoost)) {
      const next = updateScalarControl(
        controls.invertBoost,
        expressions.invertBoost,
      );
      controls.invertBoost = next.value;
      expressions.invertBoost = next.expression;
      shaderEnv.invert = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.solarizeBoost)) {
      const next = updateScalarControl(
        controls.solarizeBoost,
        expressions.solarizeBoost,
      );
      controls.solarizeBoost = next.value;
      expressions.solarizeBoost = next.expression;
      shaderEnv.solarize = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.textureAmount)) {
      const next = updateScalarControl(
        controls.textureLayer.amount,
        expressions.textureLayer.amount,
      );
      controls.textureLayer.amount = next.value;
      expressions.textureLayer.amount = next.expression;
      if (controls.textureLayer.mode === 'none') {
        controls.textureLayer.mode = 'mix';
      }
      return true;
    }
    if (matchesAlias(scalarAliases.textureScaleX)) {
      const next = updateScalarControl(
        controls.textureLayer.scaleX,
        expressions.textureLayer.scaleX,
      );
      controls.textureLayer.scaleX = next.value;
      expressions.textureLayer.scaleX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureScaleY)) {
      const next = updateScalarControl(
        controls.textureLayer.scaleY,
        expressions.textureLayer.scaleY,
      );
      controls.textureLayer.scaleY = next.value;
      expressions.textureLayer.scaleY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureOffsetX)) {
      const next = updateScalarControl(
        controls.textureLayer.offsetX,
        expressions.textureLayer.offsetX,
      );
      controls.textureLayer.offsetX = next.value;
      expressions.textureLayer.offsetX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureOffsetY)) {
      const next = updateScalarControl(
        controls.textureLayer.offsetY,
        expressions.textureLayer.offsetY,
      );
      controls.textureLayer.offsetY = next.value;
      expressions.textureLayer.offsetY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureAmount)) {
      const next = updateScalarControl(
        controls.warpTexture.amount,
        expressions.warpTexture.amount,
      );
      controls.warpTexture.amount = next.value;
      expressions.warpTexture.amount = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureScaleX)) {
      const next = updateScalarControl(
        controls.warpTexture.scaleX,
        expressions.warpTexture.scaleX,
      );
      controls.warpTexture.scaleX = next.value;
      expressions.warpTexture.scaleX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureScaleY)) {
      const next = updateScalarControl(
        controls.warpTexture.scaleY,
        expressions.warpTexture.scaleY,
      );
      controls.warpTexture.scaleY = next.value;
      expressions.warpTexture.scaleY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureOffsetX)) {
      const next = updateScalarControl(
        controls.warpTexture.offsetX,
        expressions.warpTexture.offsetX,
      );
      controls.warpTexture.offsetX = next.value;
      expressions.warpTexture.offsetX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureOffsetY)) {
      const next = updateScalarControl(
        controls.warpTexture.offsetY,
        expressions.warpTexture.offsetY,
      );
      controls.warpTexture.offsetY = next.value;
      expressions.warpTexture.offsetY = next.expression;
      return true;
    }
  }

  const evaluatedValue = evaluateMilkdropShaderExpression(
    resolvedExpression,
    shaderValueEnv,
    shaderEnv,
  );
  if (
    key === 'uv' ||
    key === 'ret' ||
    key === 'shader_body' ||
    key === 'tint' ||
    isKnownShaderScalarKey(key)
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

export function buildShaderProgramPayload({
  stage,
  statements,
  normalizedLines,
  requiresControlFallback,
  supportedBackends,
}: {
  stage: MilkdropShaderProgramStage;
  statements: MilkdropShaderStatement[];
  normalizedLines: string[];
  requiresControlFallback: boolean;
  supportedBackends: MilkdropRenderBackend[];
}): MilkdropShaderProgramPayload {
  const entryTarget = stage === 'warp' ? 'uv' : 'ret';
  const programStatements = statements.map((statement) => ({
    ...statement,
    target:
      statement.target.toLowerCase() === 'shader_body'
        ? entryTarget
        : statement.target,
  }));
  return {
    stage,
    source: normalizedLines.join('; '),
    normalizedLines,
    statements: programStatements,
    execution: {
      kind: 'direct-feedback-program',
      stage,
      entryTarget,
      supportedBackends,
      requiresControlFallback,
      statementTargets: programStatements.map((statement) => statement.target),
    },
  };
}

function isUnsupportedParsedShaderStatement({
  statement,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
}: {
  statement: MilkdropShaderStatement;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
}) {
  const key = statement.target.toLowerCase();
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  if (key === 'texture_source' || key === 'warp_texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    return !source || !isAuxShaderSamplerName(source);
  }

  if (key === 'texture_mode') {
    const mode =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderTextureBlendMode(resolvedExpression.name)
        : parseShaderTextureBlendMode(statement.rawValue);
    return !mode;
  }

  if (key !== 'ret' && key !== 'shader_body') {
    return false;
  }

  const directSample = getShaderSampleInfo(resolvedExpression);
  if (
    directSample &&
    ((directSample.sampleDimension === '3d' &&
      isUnsupportedVolumeSampleSource(directSample.source)) ||
      (directSample.source !== 'main' &&
        directSample.source !== 'none' &&
        !isAuxShaderSamplerName(directSample.source)))
  ) {
    return true;
  }

  if (
    resolvedExpression.type !== 'call' ||
    resolvedExpression.name.toLowerCase() !== 'mix' ||
    resolvedExpression.args.length < 3 ||
    !isShaderSampleRgbExpression(
      resolvedExpression.args[0] as MilkdropShaderExpressionNode,
    )
  ) {
    return false;
  }

  const baseSample = getShaderSampleInfo(
    resolvedExpression.args[0] as MilkdropShaderExpressionNode,
  );
  const amount = evaluateShaderScalarResult(
    resolvedExpression.args[2] as MilkdropShaderExpressionNode,
    shaderValueEnv,
    shaderEnv,
    shaderExpressionEnv,
  );
  if (!amount || baseSample?.source !== 'main') {
    return false;
  }

  const targetNode = resolvedExpression.args[1] as MilkdropShaderExpressionNode;
  const auxSample = getShaderSampleInfo(targetNode);
  if (
    auxSample &&
    auxSample.source !== 'main' &&
    auxSample.source !== 'none' &&
    !isAuxShaderSamplerName(auxSample.source)
  ) {
    return true;
  }

  const invertedSample = extractShaderInvertedSampleExpression(targetNode);
  if (!invertedSample || invertedSample === 'main') {
    return false;
  }

  return !isAuxShaderSamplerName(invertedSample.source);
}

function shouldEmitDirectProgramStatement(target: string) {
  const key = target.toLowerCase();
  if (
    key === 'uv' ||
    key === 'ret' ||
    key === 'return' ||
    key === 'shader_body'
  ) {
    return true;
  }
  if (
    isKnownShaderScalarKey(key) ||
    key === 'tint' ||
    key === 'texture_source' ||
    key === 'texture_mode' ||
    key === 'warp_texture_source'
  ) {
    return false;
  }
  return true;
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

  let supportedLineCount = 0;
  normalized.forEach((line) => {
    const parsedStatement = parseMilkdropShaderStatement(line);
    if (parsedStatement) {
      statements.push(parsedStatement);
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
      if (shouldEmitDirectProgramStatement(parsedStatement.target)) {
        directProgramStatements.push(parsedStatement);
        directProgramLines.push(line);
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
      case 'texture_source': {
        const source = parseShaderSamplerSource(rawValue);
        if (source && isAuxShaderSamplerName(source)) {
          controls.textureLayer.source = source;
          if (controls.textureLayer.mode === 'none') {
            controls.textureLayer.mode = 'mix';
          }
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'texture_mode': {
        const mode = parseShaderTextureBlendMode(rawValue);
        if (mode) {
          controls.textureLayer.mode = mode;
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'warp_texture_source': {
        const source = parseShaderSamplerSource(rawValue);
        if (source && isAuxShaderSamplerName(source)) {
          controls.warpTexture.source = source;
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'warp':
      case 'warp_scale':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpScale,
            expressions.warpScale,
            numeric.value,
            numeric.expression,
          );
          controls.warpScale = next.value;
          expressions.warpScale = next.expression;
          shaderEnv.warp = next.value;
          shaderEnv.warp_scale = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dx':
      case 'offset_x':
      case 'translate_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.offsetX,
            expressions.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.offsetX = next.value;
          expressions.offsetX = next.expression;
          shaderEnv.dx = next.value;
          shaderEnv.offset_x = next.value;
          shaderEnv.translate_x = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dy':
      case 'offset_y':
      case 'translate_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.offsetY,
            expressions.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.offsetY = next.value;
          expressions.offsetY = next.expression;
          shaderEnv.dy = next.value;
          shaderEnv.offset_y = next.value;
          shaderEnv.translate_y = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'rot':
      case 'rotation':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.rotation,
            expressions.rotation,
            numeric.value,
            numeric.expression,
          );
          controls.rotation = next.value;
          expressions.rotation = next.expression;
          shaderEnv.rot = next.value;
          shaderEnv.rotation = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'zoom':
      case 'scale':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.zoom,
            expressions.zoom,
            numeric.value,
            numeric.expression,
          );
          controls.zoom = next.value;
          expressions.zoom = next.expression;
          shaderEnv.zoom = next.value;
          shaderEnv.scale = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'saturation':
      case 'sat':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.saturation,
            expressions.saturation,
            numeric.value,
            numeric.expression,
          );
          controls.saturation = next.value;
          expressions.saturation = next.expression;
          shaderEnv.saturation = next.value;
          shaderEnv.sat = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'contrast':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.contrast,
            expressions.contrast,
            numeric.value,
            numeric.expression,
          );
          controls.contrast = next.value;
          expressions.contrast = next.expression;
          shaderEnv.contrast = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'r':
      case 'red':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.r,
            expressions.colorScale.r,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.r = next.value;
          expressions.colorScale.r = next.expression;
          shaderEnv.r = next.value;
          shaderEnv.red = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'g':
      case 'green':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.g,
            expressions.colorScale.g,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.g = next.value;
          expressions.colorScale.g = next.expression;
          shaderEnv.g = next.value;
          shaderEnv.green = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'b':
      case 'blue':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.b,
            expressions.colorScale.b,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.b = next.value;
          expressions.colorScale.b = next.expression;
          shaderEnv.b = next.value;
          shaderEnv.blue = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'hue':
      case 'hue_shift':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.hueShift,
            expressions.hueShift,
            numeric.value,
            numeric.expression,
          );
          controls.hueShift = next.value;
          expressions.hueShift = next.expression;
          shaderEnv.hue = next.value;
          shaderEnv.hue_shift = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'mix':
      case 'feedback':
      case 'feedback_alpha':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.mixAlpha,
            expressions.mixAlpha,
            numeric.value,
            numeric.expression,
          );
          controls.mixAlpha = next.value;
          expressions.mixAlpha = next.expression;
          shaderEnv.mix = next.value;
          shaderEnv.feedback = next.value;
          shaderEnv.feedback_alpha = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'brighten':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.brightenBoost,
            expressions.brightenBoost,
            numeric.value,
            numeric.expression,
          );
          controls.brightenBoost = next.value;
          expressions.brightenBoost = next.expression;
          shaderEnv.brighten = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'invert':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.invertBoost,
            expressions.invertBoost,
            numeric.value,
            numeric.expression,
          );
          controls.invertBoost = next.value;
          expressions.invertBoost = next.expression;
          shaderEnv.invert = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'solarize':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.solarizeBoost,
            expressions.solarizeBoost,
            numeric.value,
            numeric.expression,
          );
          controls.solarizeBoost = next.value;
          expressions.solarizeBoost = next.expression;
          shaderEnv.solarize = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_amount':
      case 'texture_mix':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.amount,
            expressions.textureLayer.amount,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.amount = next.value;
          expressions.textureLayer.amount = next.expression;
          if (controls.textureLayer.mode === 'none') {
            controls.textureLayer.mode = 'mix';
          }
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_scale':
      case 'texture_scale_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.scaleX,
            expressions.textureLayer.scaleX,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.scaleX = next.value;
          expressions.textureLayer.scaleX = next.expression;
          supportedLineCount += 1;
          if (key === 'texture_scale') {
            controls.textureLayer.scaleY = next.value;
            expressions.textureLayer.scaleY = next.expression;
          }
          return;
        }
        break;
      case 'texture_scale_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.scaleY,
            expressions.textureLayer.scaleY,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.scaleY = next.value;
          expressions.textureLayer.scaleY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_offset_x':
      case 'texture_scroll_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.offsetX,
            expressions.textureLayer.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.offsetX = next.value;
          expressions.textureLayer.offsetX = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_offset_y':
      case 'texture_scroll_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.offsetY,
            expressions.textureLayer.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.offsetY = next.value;
          expressions.textureLayer.offsetY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_amount':
      case 'warp_texture_mix':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.amount,
            expressions.warpTexture.amount,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.amount = next.value;
          expressions.warpTexture.amount = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_scale':
      case 'warp_texture_scale_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.scaleX,
            expressions.warpTexture.scaleX,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.scaleX = next.value;
          expressions.warpTexture.scaleX = next.expression;
          supportedLineCount += 1;
          if (key === 'warp_texture_scale') {
            controls.warpTexture.scaleY = next.value;
            expressions.warpTexture.scaleY = next.expression;
          }
          return;
        }
        break;
      case 'warp_texture_scale_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.scaleY,
            expressions.warpTexture.scaleY,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.scaleY = next.value;
          expressions.warpTexture.scaleY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_offset_x':
      case 'warp_texture_scroll_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.offsetX,
            expressions.warpTexture.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.offsetX = next.value;
          expressions.warpTexture.offsetX = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_offset_y':
      case 'warp_texture_scroll_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.offsetY,
            expressions.warpTexture.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.offsetY = next.value;
          expressions.warpTexture.offsetY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
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
      directProgramStatements.length === 0,
    statements,
    directProgramStatements,
    directProgramLines,
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

export function evaluateMilkdropShaderControlExpressions({
  controls,
  expressions,
  env,
}: {
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  env: Record<string, number>;
}) {
  const next: MilkdropShaderControls = structuredClone(controls);
  const evaluateScalar = (
    expression: MilkdropExpressionNode | null,
    fallback: number,
  ) => {
    if (!expression) {
      return fallback;
    }
    return evaluateMilkdropExpression(expression, env);
  };

  next.warpScale = evaluateScalar(expressions.warpScale, next.warpScale);
  next.offsetX = evaluateScalar(expressions.offsetX, next.offsetX);
  next.offsetY = evaluateScalar(expressions.offsetY, next.offsetY);
  next.rotation = evaluateScalar(expressions.rotation, next.rotation);
  next.zoom = evaluateScalar(expressions.zoom, next.zoom);
  next.saturation = evaluateScalar(expressions.saturation, next.saturation);
  next.contrast = evaluateScalar(expressions.contrast, next.contrast);
  next.colorScale.r = evaluateScalar(
    expressions.colorScale.r,
    next.colorScale.r,
  );
  next.colorScale.g = evaluateScalar(
    expressions.colorScale.g,
    next.colorScale.g,
  );
  next.colorScale.b = evaluateScalar(
    expressions.colorScale.b,
    next.colorScale.b,
  );
  next.hueShift = evaluateScalar(expressions.hueShift, next.hueShift);
  next.mixAlpha = evaluateScalar(expressions.mixAlpha, next.mixAlpha);
  next.brightenBoost = evaluateScalar(
    expressions.brightenBoost,
    next.brightenBoost,
  );
  next.invertBoost = evaluateScalar(expressions.invertBoost, next.invertBoost);
  next.solarizeBoost = evaluateScalar(
    expressions.solarizeBoost,
    next.solarizeBoost,
  );
  next.tint.r = evaluateScalar(expressions.tint.r, next.tint.r);
  next.tint.g = evaluateScalar(expressions.tint.g, next.tint.g);
  next.tint.b = evaluateScalar(expressions.tint.b, next.tint.b);
  next.textureLayer.amount = evaluateScalar(
    expressions.textureLayer.amount,
    next.textureLayer.amount,
  );
  next.textureLayer.scaleX = evaluateScalar(
    expressions.textureLayer.scaleX,
    next.textureLayer.scaleX,
  );
  next.textureLayer.scaleY = evaluateScalar(
    expressions.textureLayer.scaleY,
    next.textureLayer.scaleY,
  );
  next.textureLayer.offsetX = evaluateScalar(
    expressions.textureLayer.offsetX,
    next.textureLayer.offsetX,
  );
  next.textureLayer.offsetY = evaluateScalar(
    expressions.textureLayer.offsetY,
    next.textureLayer.offsetY,
  );
  next.textureLayer.volumeSliceZ = expressions.textureLayer.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.textureLayer.volumeSliceZ, env)
    : next.textureLayer.volumeSliceZ;
  next.warpTexture.amount = evaluateScalar(
    expressions.warpTexture.amount,
    next.warpTexture.amount,
  );
  next.warpTexture.scaleX = evaluateScalar(
    expressions.warpTexture.scaleX,
    next.warpTexture.scaleX,
  );
  next.warpTexture.scaleY = evaluateScalar(
    expressions.warpTexture.scaleY,
    next.warpTexture.scaleY,
  );
  next.warpTexture.offsetX = evaluateScalar(
    expressions.warpTexture.offsetX,
    next.warpTexture.offsetX,
  );
  next.warpTexture.offsetY = evaluateScalar(
    expressions.warpTexture.offsetY,
    next.warpTexture.offsetY,
  );
  next.warpTexture.volumeSliceZ = expressions.warpTexture.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.warpTexture.volumeSliceZ, env)
    : next.warpTexture.volumeSliceZ;
  return next;
}

function pickShaderScalar(
  primaryValue: number,
  primaryExpression: MilkdropExpressionNode | null,
  secondaryValue: number,
  secondaryExpression: MilkdropExpressionNode | null,
  defaultValue: number,
) {
  if (primaryExpression || primaryValue !== defaultValue) {
    return { value: primaryValue, expression: primaryExpression };
  }
  return { value: secondaryValue, expression: secondaryExpression };
}

export function mergeShaderControlAnalysis(
  warpAnalysis: ReturnType<typeof extractShaderControls>,
  compAnalysis: ReturnType<typeof extractShaderControls>,
) {
  const warpScale = pickShaderScalar(
    warpAnalysis.controls.warpScale,
    warpAnalysis.expressions.warpScale,
    compAnalysis.controls.warpScale,
    compAnalysis.expressions.warpScale,
    0,
  );
  const offsetX = pickShaderScalar(
    warpAnalysis.controls.offsetX,
    warpAnalysis.expressions.offsetX,
    compAnalysis.controls.offsetX,
    compAnalysis.expressions.offsetX,
    0,
  );
  const offsetY = pickShaderScalar(
    warpAnalysis.controls.offsetY,
    warpAnalysis.expressions.offsetY,
    compAnalysis.controls.offsetY,
    compAnalysis.expressions.offsetY,
    0,
  );
  const rotation = pickShaderScalar(
    warpAnalysis.controls.rotation,
    warpAnalysis.expressions.rotation,
    compAnalysis.controls.rotation,
    compAnalysis.expressions.rotation,
    0,
  );
  const zoom = pickShaderScalar(
    warpAnalysis.controls.zoom,
    warpAnalysis.expressions.zoom,
    compAnalysis.controls.zoom,
    compAnalysis.expressions.zoom,
    1,
  );
  const saturation = pickShaderScalar(
    compAnalysis.controls.saturation,
    compAnalysis.expressions.saturation,
    warpAnalysis.controls.saturation,
    warpAnalysis.expressions.saturation,
    1,
  );
  const contrast = pickShaderScalar(
    compAnalysis.controls.contrast,
    compAnalysis.expressions.contrast,
    warpAnalysis.controls.contrast,
    warpAnalysis.expressions.contrast,
    1,
  );
  const hueShift = pickShaderScalar(
    compAnalysis.controls.hueShift,
    compAnalysis.expressions.hueShift,
    warpAnalysis.controls.hueShift,
    warpAnalysis.expressions.hueShift,
    0,
  );
  const mixAlpha = pickShaderScalar(
    compAnalysis.controls.mixAlpha,
    compAnalysis.expressions.mixAlpha,
    warpAnalysis.controls.mixAlpha,
    warpAnalysis.expressions.mixAlpha,
    0,
  );
  const brightenBoost = pickShaderScalar(
    compAnalysis.controls.brightenBoost,
    compAnalysis.expressions.brightenBoost,
    warpAnalysis.controls.brightenBoost,
    warpAnalysis.expressions.brightenBoost,
    0,
  );
  const invertBoost = pickShaderScalar(
    compAnalysis.controls.invertBoost,
    compAnalysis.expressions.invertBoost,
    warpAnalysis.controls.invertBoost,
    warpAnalysis.expressions.invertBoost,
    0,
  );
  const solarizeBoost = pickShaderScalar(
    compAnalysis.controls.solarizeBoost,
    compAnalysis.expressions.solarizeBoost,
    warpAnalysis.controls.solarizeBoost,
    warpAnalysis.expressions.solarizeBoost,
    0,
  );
  const colorScale = {
    r: pickShaderScalar(
      compAnalysis.controls.colorScale.r,
      compAnalysis.expressions.colorScale.r,
      warpAnalysis.controls.colorScale.r,
      warpAnalysis.expressions.colorScale.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.colorScale.g,
      compAnalysis.expressions.colorScale.g,
      warpAnalysis.controls.colorScale.g,
      warpAnalysis.expressions.colorScale.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.colorScale.b,
      compAnalysis.expressions.colorScale.b,
      warpAnalysis.controls.colorScale.b,
      warpAnalysis.expressions.colorScale.b,
      1,
    ),
  };
  const tint = {
    r: pickShaderScalar(
      compAnalysis.controls.tint.r,
      compAnalysis.expressions.tint.r,
      warpAnalysis.controls.tint.r,
      warpAnalysis.expressions.tint.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.tint.g,
      compAnalysis.expressions.tint.g,
      warpAnalysis.controls.tint.g,
      warpAnalysis.expressions.tint.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.tint.b,
      compAnalysis.expressions.tint.b,
      warpAnalysis.controls.tint.b,
      warpAnalysis.expressions.tint.b,
      1,
    ),
  };
  const textureLayerAmount = pickShaderScalar(
    compAnalysis.controls.textureLayer.amount,
    compAnalysis.expressions.textureLayer.amount,
    warpAnalysis.controls.textureLayer.amount,
    warpAnalysis.expressions.textureLayer.amount,
    0,
  );
  const textureLayerScaleX = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleX,
    compAnalysis.expressions.textureLayer.scaleX,
    warpAnalysis.controls.textureLayer.scaleX,
    warpAnalysis.expressions.textureLayer.scaleX,
    1,
  );
  const textureLayerScaleY = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleY,
    compAnalysis.expressions.textureLayer.scaleY,
    warpAnalysis.controls.textureLayer.scaleY,
    warpAnalysis.expressions.textureLayer.scaleY,
    1,
  );
  const textureLayerOffsetX = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetX,
    compAnalysis.expressions.textureLayer.offsetX,
    warpAnalysis.controls.textureLayer.offsetX,
    warpAnalysis.expressions.textureLayer.offsetX,
    0,
  );
  const textureLayerOffsetY = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetY,
    compAnalysis.expressions.textureLayer.offsetY,
    warpAnalysis.controls.textureLayer.offsetY,
    warpAnalysis.expressions.textureLayer.offsetY,
    0,
  );
  const textureLayerSample =
    compAnalysis.controls.textureLayer.mode !== 'none'
      ? compAnalysis
      : warpAnalysis;
  const warpTextureAmount = pickShaderScalar(
    warpAnalysis.controls.warpTexture.amount,
    warpAnalysis.expressions.warpTexture.amount,
    compAnalysis.controls.warpTexture.amount,
    compAnalysis.expressions.warpTexture.amount,
    0,
  );
  const warpTextureScaleX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleX,
    warpAnalysis.expressions.warpTexture.scaleX,
    compAnalysis.controls.warpTexture.scaleX,
    compAnalysis.expressions.warpTexture.scaleX,
    1,
  );
  const warpTextureScaleY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleY,
    warpAnalysis.expressions.warpTexture.scaleY,
    compAnalysis.controls.warpTexture.scaleY,
    compAnalysis.expressions.warpTexture.scaleY,
    1,
  );
  const warpTextureOffsetX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetX,
    warpAnalysis.expressions.warpTexture.offsetX,
    compAnalysis.controls.warpTexture.offsetX,
    compAnalysis.expressions.warpTexture.offsetX,
    0,
  );
  const warpTextureOffsetY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetY,
    warpAnalysis.expressions.warpTexture.offsetY,
    compAnalysis.controls.warpTexture.offsetY,
    compAnalysis.expressions.warpTexture.offsetY,
    0,
  );
  const warpTextureSample =
    warpAnalysis.controls.warpTexture.source !== 'none'
      ? warpAnalysis
      : compAnalysis;

  return {
    controls: {
      warpScale: warpScale.value,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      rotation: rotation.value,
      zoom: zoom.value,
      saturation: saturation.value,
      contrast: contrast.value,
      colorScale: {
        r: colorScale.r.value,
        g: colorScale.g.value,
        b: colorScale.b.value,
      },
      hueShift: hueShift.value,
      mixAlpha: mixAlpha.value,
      brightenBoost: brightenBoost.value,
      invertBoost: invertBoost.value,
      solarizeBoost: solarizeBoost.value,
      tint: {
        r: tint.r.value,
        g: tint.g.value,
        b: tint.b.value,
      },
      textureLayer: {
        source:
          compAnalysis.controls.textureLayer.source !== 'none'
            ? compAnalysis.controls.textureLayer.source
            : warpAnalysis.controls.textureLayer.source,
        mode:
          compAnalysis.controls.textureLayer.mode !== 'none'
            ? compAnalysis.controls.textureLayer.mode
            : warpAnalysis.controls.textureLayer.mode,
        sampleDimension:
          textureLayerSample.controls.textureLayer.sampleDimension,
        inverted: textureLayerSample.controls.textureLayer.inverted,
        amount: textureLayerAmount.value,
        scaleX: textureLayerScaleX.value,
        scaleY: textureLayerScaleY.value,
        offsetX: textureLayerOffsetX.value,
        offsetY: textureLayerOffsetY.value,
        volumeSliceZ: textureLayerSample.controls.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        source:
          warpAnalysis.controls.warpTexture.source !== 'none'
            ? warpAnalysis.controls.warpTexture.source
            : compAnalysis.controls.warpTexture.source,
        sampleDimension: warpTextureSample.controls.warpTexture.sampleDimension,
        amount: warpTextureAmount.value,
        scaleX: warpTextureScaleX.value,
        scaleY: warpTextureScaleY.value,
        offsetX: warpTextureOffsetX.value,
        offsetY: warpTextureOffsetY.value,
        volumeSliceZ: warpTextureSample.controls.warpTexture.volumeSliceZ,
      },
    },
    expressions: {
      warpScale: warpScale.expression,
      offsetX: offsetX.expression,
      offsetY: offsetY.expression,
      rotation: rotation.expression,
      zoom: zoom.expression,
      saturation: saturation.expression,
      contrast: contrast.expression,
      colorScale: {
        r: colorScale.r.expression,
        g: colorScale.g.expression,
        b: colorScale.b.expression,
      },
      hueShift: hueShift.expression,
      mixAlpha: mixAlpha.expression,
      brightenBoost: brightenBoost.expression,
      invertBoost: invertBoost.expression,
      solarizeBoost: solarizeBoost.expression,
      tint: {
        r: tint.r.expression,
        g: tint.g.expression,
        b: tint.b.expression,
      },
      textureLayer: {
        sampleDimension:
          textureLayerSample.expressions.textureLayer.sampleDimension,
        amount: textureLayerAmount.expression,
        scaleX: textureLayerScaleX.expression,
        scaleY: textureLayerScaleY.expression,
        offsetX: textureLayerOffsetX.expression,
        offsetY: textureLayerOffsetY.expression,
        volumeSliceZ: textureLayerSample.expressions.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        sampleDimension:
          warpTextureSample.expressions.warpTexture.sampleDimension,
        amount: warpTextureAmount.expression,
        scaleX: warpTextureScaleX.expression,
        scaleY: warpTextureScaleY.expression,
        offsetX: warpTextureOffsetX.expression,
        offsetY: warpTextureOffsetY.expression,
        volumeSliceZ: warpTextureSample.expressions.warpTexture.volumeSliceZ,
      },
    },
  };
}
