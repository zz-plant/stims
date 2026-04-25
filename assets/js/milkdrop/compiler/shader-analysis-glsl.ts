import type {
  MilkdropShaderExpressionNode,
  MilkdropShaderStatement,
} from '../types';
import {
  isAuxShaderSamplerName,
  normalizeShaderSamplerName,
} from './shader-analysis-helpers';

type GlslEmitter = {
  emitIdentifier: (name: string) => string;
  emitLiteral: (value: number) => string;
  emitBinary: (left: string, op: string, right: string) => string;
  emitUnary: (op: string, operand: string) => string;
  emitCall: (name: string, args: string[]) => string | null;
  emitMember: (object: string, property: string) => string;
};

/**
 * Emits a MilkDrop shader expression as a GLSL expression string.
 * Handles tex2D/tex3D → GLSL texture sampling, standard math functions, etc.
 */
function emitExpression(
  node: MilkdropShaderExpressionNode,
  emitter: GlslEmitter,
): string | null {
  switch (node.type) {
    case 'literal':
      return emitter.emitLiteral(node.value);
    case 'identifier':
      return emitter.emitIdentifier(node.name);
    case 'unary': {
      const operand = emitExpression(node.operand, emitter);
      if (operand === null) return null;
      if (node.operator === '+') return operand;
      if (node.operator === '-') return `-(${operand})`;
      if (node.operator === '!') return `(1.0 - (${operand}))`;
      return null;
    }
    case 'binary': {
      const left = emitExpression(node.left, emitter);
      const right = emitExpression(node.right, emitter);
      if (left === null || right === null) return null;
      return emitter.emitBinary(left, node.operator, right);
    }
    case 'member': {
      const object = emitExpression(node.object, emitter);
      if (object === null) return null;
      return emitter.emitMember(object, node.property);
    }
    case 'call': {
      const name = node.name;
      const args = node.args
        .map((arg) => emitExpression(arg, emitter))
        .filter((value): value is string => value !== null);
      if (args.length !== node.args.length) return null;
      return emitter.emitCall(name, args);
    }
    default:
      return null;
  }
}

/**
 * Creates a GLSL emitter that maps MilkDrop sampler/texture names to GLSL
 * functions in the composite shader.
 */
export function createCompositeGlslEmitter(): GlslEmitter {
  return {
    emitIdentifier(name: string): string {
      const lower = name.toLowerCase();
      // Map common MilkDrop shader variables to composite shader uniforms
      const uniformMap: Record<string, string> = {
        time: 'signalTime',
        bass: 'signalBass',
        bass_att: 'signalBass',
        mid: 'signalMid',
        mids: 'signalMid',
        mid_att: 'signalMid',
        treb: 'signalTreb',
        treb_att: 'signalTreb',
        treble: 'signalTreb',
        beat: 'signalBeat',
        beat_pulse: 'signalBeatPulse',
        progress: 'signalTime',
        vol: 'signalEnergy',
        rms: 'signalEnergy',
        music: 'signalEnergy',
        weighted_energy: 'signalEnergy',
        pi: '3.14159265359',
        e: '2.71828182846',
        warp: 'warpScale',
        warp_scale: 'warpScale',
        dx: 'offsetX',
        offset_x: 'offsetX',
        translate_x: 'offsetX',
        dy: 'offsetY',
        offset_y: 'offsetY',
        translate_y: 'offsetY',
        rot: 'rotation',
        rotation: 'rotation',
        zoom: 'zoomMul',
        scale: 'zoomMul',
        saturation: 'saturation',
        sat: 'saturation',
        contrast: 'contrast',
        r: 'colorScale.r',
        red: 'colorScale.r',
        g: 'colorScale.g',
        green: 'colorScale.g',
        b: 'colorScale.b',
        blue: 'colorScale.b',
        hue: 'hueShift',
        hue_shift: 'hueShift',
        mix: 'mixAlpha',
        feedback: 'mixAlpha',
        feedback_alpha: 'mixAlpha',
        brighten: 'brightenBoost',
        invert: 'invertBoost',
        solarize: 'solarizeBoost',
        tint_r: 'tint.r',
        tint_g: 'tint.g',
        tint_b: 'tint.b',
        uv: 'vUv',
      };
      return uniformMap[lower] ?? name;
    },

    emitLiteral(value: number): string {
      if (Number.isInteger(value) && Math.abs(value) < 1000000) {
        return `${value}.0`;
      }
      return value.toFixed(10);
    },

    emitBinary(left: string, op: string, right: string): string {
      const glslOp = op === '&&' ? '*' : op === '||' ? '+' : op;
      return `(${left} ${glslOp} ${right})`;
    },

    emitUnary(op: string, operand: string): string {
      return op === '-' ? `-(${operand})` : operand;
    },

    emitCall(name: string, args: string[]): string | null {
      const lower = name.toLowerCase();

      // Sampler functions: tex2D(sampler_main, uv) → texture2D(currentTex, sampleUv(uv, textureWrap))
      if (lower === 'tex2d' || lower === 'texture' || lower === 'texture2d') {
        return emitTextureSample(args, '2d');
      }
      if (lower === 'tex3d' || lower === 'texture3d') {
        return emitTextureSample(args, '3d');
      }
      if (lower === 'videotex2d') {
        // video texture sampling - maps to videoTex
        const coord = args[1] ?? args[0];
        return coord
          ? `sampleAuxTexture(8.0, 0.0, sampleUv(${coord}, textureWrap), 0.0).rgb`
          : null;
      }

      // Math functions
      if (lower === 'mix' || lower === 'lerp') {
        const a = args[0] ?? '0.0';
        const b = args[1] ?? '0.0';
        const t = args[2] ?? '0.0';
        return `mix(${a}, ${b}, ${t})`;
      }
      if (lower === 'if') {
        const cond = args[0] ?? '0.0';
        const thenVal = args[1] ?? '0.0';
        const elseVal = args[2] ?? '0.0';
        return `mix(${elseVal}, ${thenVal}, step(0.0001, ${cond}))`;
      }
      if (lower === 'abs') {
        return `abs(${args[0] ?? '0.0'})`;
      }
      if (lower === 'pow') {
        return `pow(${args[0] ?? '0.0'}, ${args[1] ?? '2.0'})`;
      }
      if (lower === 'sqrt') {
        return `sqrt(${args[0] ?? '0.0'})`;
      }
      if (lower === 'sin') {
        return `sin(${args[0] ?? '0.0'})`;
      }
      if (lower === 'cos') {
        return `cos(${args[0] ?? '0.0'})`;
      }
      if (lower === 'tan') {
        return `tan(${args[0] ?? '0.0'})`;
      }
      if (lower === 'fract') {
        return `fract(${args[0] ?? '0.0'})`;
      }
      if (lower === 'floor') {
        return `floor(${args[0] ?? '0.0'})`;
      }
      if (lower === 'ceil') {
        return `ceil(${args[0] ?? '0.0'})`;
      }
      if (lower === 'min') {
        return `min(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'max') {
        return `max(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'clamp') {
        return `clamp(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'}, ${args[2] ?? '1.0'})`;
      }
      if (lower === 'step') {
        return `step(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'smoothstep') {
        return `smoothstep(${args[0] ?? '0.0'}, ${args[1] ?? '1.0'}, ${args[2] ?? '0.0'})`;
      }
      if (lower === 'length') {
        return `length(${args[0] ?? '0.0'})`;
      }
      if (lower === 'dot') {
        return `dot(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'cross') {
        return `cross(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'normalize') {
        return `normalize(${args[0] ?? '0.0'})`;
      }
      if (lower === 'mod' || lower === 'fmod') {
        return `mod(${args[0] ?? '0.0'}, ${args[1] ?? '1.0'})`;
      }
      if (lower === 'above') {
        return `step(${args[1] ?? '0.0'}, ${args[0] ?? '0.0'})`;
      }
      if (lower === 'below') {
        return `step(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
      }
      if (lower === 'equal') {
        return `step(abs(${args[0] ?? '0.0'} - ${args[1] ?? '0.0'}), 0.0001)`;
      }
      if (lower === 'sign') {
        return `sign(${args[0] ?? '0.0'})`;
      }
      if (lower === 'log') {
        return `log(${args[0] ?? '1.0'})`;
      }
      if (lower === 'exp') {
        return `exp(${args[0] ?? '0.0'})`;
      }
      if (lower === 'atan' || lower === 'atan2') {
        const y = args[0] ?? '0.0';
        const x = args[1] ?? '1.0';
        return `atan(${y}, ${x})`;
      }
      if (lower === 'sigmoid') {
        const val = args[0] ?? '0.0';
        const slope = args[1] ?? '1.0';
        return `1.0 / (1.0 + exp(-(${val}) * (${slope})))`;
      }
      if (lower === 'asin') {
        return `asin(clamp(${args[0] ?? '0.0'}, -1.0, 1.0))`;
      }
      if (lower === 'acos') {
        return `acos(clamp(${args[0] ?? '0.0'}, -1.0, 1.0))`;
      }
      if (lower === 'rand') {
        // Simple deterministic pseudo-random
        const seed = args[0] ?? '0.0';
        return `fract(sin(dot(${seed}, vec2(12.9898, 78.233))) * 43758.5453)`;
      }
      if (lower === 'noise') {
        // Simple noise approximation
        const coord = args[0] ?? 'vUv';
        return `sampleAuxTexture(1.0, 0.0, sampleUv(${coord}, textureWrap), 0.0).r`;
      }

      // vec2/vec3 constructors
      if (lower === 'vec2') {
        const x = args[0] ?? '0.0';
        const y = args[1] ?? x;
        return `vec2(${x}, ${y})`;
      }
      if (lower === 'vec3') {
        const x = args[0] ?? '0.0';
        const y = args[1] ?? x;
        const z = args[2] ?? x;
        return `vec3(${x}, ${y}, ${z})`;
      }
      if (lower === 'vec4') {
        const x = args[0] ?? '0.0';
        const y = args[1] ?? x;
        const z = args[2] ?? x;
        const w = args[3] ?? x;
        return `vec4(${x}, ${y}, ${z}, ${w})`;
      }
      if (lower === 'float') {
        return `float(${args[0] ?? '0.0'})`;
      }

      // tint constructor
      if (lower === 'tint') {
        const r = args[0] ?? '1.0';
        const g = args[1] ?? r;
        const b = args[2] ?? r;
        return `vec3(${r}, ${g}, ${b})`;
      }

      // General purpose: try bare function call
      return `${lower}(${args.join(', ')})`;
    },

    emitMember(object: string, property: string): string {
      const lowerProp = property.toLowerCase();
      // Map swizzle components and common member accessors
      const validSwizzles = new Set([
        'x',
        'y',
        'z',
        'w',
        'r',
        'g',
        'b',
        'a',
        'xy',
        'xz',
        'yz',
        'rg',
        'rb',
        'gb',
        'rgb',
        'rgba',
      ]);
      if (validSwizzles.has(lowerProp)) {
        return `${object}.${lowerProp}`;
      }
      return `${object}_${lowerProp}`;
    },
  };
}

/**
 * Emits a texture sample expression in GLSL.
 */
function emitTextureSample(
  args: string[],
  dimension: '2d' | '3d',
): string | null {
  const samplerArg = args[0];
  const coordArg = args[1] ?? args[0];
  if (!samplerArg || !coordArg) return null;

  // Check if sampler is a named identifier
  const samplerName = samplerArg.toLowerCase();
  const normalizedName = normalizeShaderSamplerName(samplerName);

  if (normalizedName === null) {
    // Unknown sampler - fall back to main texture
    return `texture2D(currentTex, sampleUv(${coordArg}, textureWrap)).rgb`;
  }

  if (normalizedName === 'main') {
    // Sample from the main framebuffer texture
    return `texture2D(currentTex, sampleUv(${coordArg}, textureWrap)).rgb`;
  }

  if (isAuxShaderSamplerName(normalizedName)) {
    const sourceId = getAuxTextureSourceId(normalizedName);
    const sampleDim = dimension === '3d' ? '1.0' : '0.0';
    const zSlice =
      dimension === '3d' && args.length >= 3 ? (args[2] ?? '0.0') : '0.0';
    return `sampleAuxTexture(vec4(${sourceId}, 0, 0, 0).x, ${sampleDim}, sampleUv(${coordArg}, textureWrap), ${zSlice}).rgb`;
  }

  // Unknown sampler - fall back to main texture
  return `texture2D(currentTex, sampleUv(${coordArg}, textureWrap)).rgb`;
}

/**
 * Returns the numeric source ID for an aux texture name.
 */
function getAuxTextureSourceId(name: string): string {
  const map: Record<string, string> = {
    noise: '1.0',
    simplex: '2.0',
    voronoi: '3.0',
    aura: '4.0',
    caustics: '5.0',
    pattern: '6.0',
    fractal: '7.0',
    video: '8.0',
  };
  return map[name] ?? '0.0';
}

/**
 * Generates a GLSL function body from a list of shader statements.
 * Returns GLSL code that can be embedded in a fragment shader.
 */
export function generateGlslFromShaderStatements(
  statements: MilkdropShaderStatement[],
  _stage: 'warp' | 'comp',
): string | null {
  if (statements.length === 0) return null;

  const emitter = createCompositeGlslEmitter();
  const lines: string[] = [];

  for (const statement of statements) {
    const expressionGlsl = emitExpression(statement.expression, emitter);
    if (expressionGlsl === null) {
      // If any statement fails to emit, the whole program cannot be generated
      return null;
    }

    const target = statement.target;
    const operator = statement.operator;

    if (operator === '=') {
      lines.push(`  ${target} = ${expressionGlsl};`);
    } else if (operator === '+=') {
      lines.push(`  ${target} += ${expressionGlsl};`);
    } else if (operator === '-=') {
      lines.push(`  ${target} -= ${expressionGlsl};`);
    } else if (operator === '*=') {
      lines.push(`  ${target} *= ${expressionGlsl};`);
    } else if (operator === '/=') {
      lines.push(`  ${target} /= ${expressionGlsl};`);
    } else {
      lines.push(`  ${target} = ${expressionGlsl};`);
    }
  }

  return lines.join('\n');
}

/**
 * Injects generated warp/comp GLSL into the composite shader source.
 * Uses placeholder markers to identify insertion points.
 */
export function injectDirectShaderGlsl(
  source: string,
  warpGlsl: string | null,
  compGlsl: string | null,
): string {
  let modified = source;

  if (warpGlsl) {
    // Replace the warp section between markers
    const warpStartMarker = '// --- DIRECT_WARP_START ---';
    const warpEndMarker = '// --- DIRECT_WARP_END ---';
    const warpStartIndex = modified.indexOf(warpStartMarker);
    const warpEndIndex = modified.indexOf(warpEndMarker);

    if (warpStartIndex >= 0 && warpEndIndex > warpStartIndex) {
      // There's already a marker block - replace its content
      const before = modified.substring(
        0,
        warpStartIndex + warpStartMarker.length,
      );
      const after = modified.substring(warpEndIndex);
      modified = `${before}\n${warpGlsl}\n${after}`;
    }
  }

  if (compGlsl) {
    // Replace the comp section between markers
    const compStartMarker = '// --- DIRECT_COMP_START ---';
    const compEndMarker = '// --- DIRECT_COMP_END ---';
    const compStartIndex = modified.indexOf(compStartMarker);
    const compEndIndex = modified.indexOf(compEndMarker);

    if (compStartIndex >= 0 && compEndIndex > compStartIndex) {
      const before = modified.substring(
        0,
        compStartIndex + compStartMarker.length,
      );
      const after = modified.substring(compEndIndex);
      modified = `${before}\n${compGlsl}\n${after}`;
    }
  }

  return modified;
}

/**
 * Generates complete shader variant names for warp/comp program GLSL.
 */
export function generateShaderVariantTag(
  warpGlsl: string | null,
  compGlsl: string | null,
): string {
  const parts: string[] = [];
  if (warpGlsl) parts.push('dw');
  if (compGlsl) parts.push('dc');
  return parts.length > 0 ? `-direct-${parts.join('-')}` : '';
}
