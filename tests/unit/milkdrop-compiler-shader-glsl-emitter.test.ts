import { describe, expect, test } from 'bun:test';
import {
  generateGlslFromShaderStatements,
  generateShaderVariantTag,
  injectDirectShaderGlsl,
} from '../../src/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { parseMilkdropShaderStatement } from '../../src/js/milkdrop/shader-ast.ts';
import type { MilkdropShaderStatement } from '../../src/js/milkdrop/types.ts';

// ─── Helpers ────────────────────────────────────────────────────────

function glslStatement(source: string): MilkdropShaderStatement {
  const result = parseMilkdropShaderStatement(source);
  if (!result) {
    throw new Error(`Failed to parse GLSL statement: ${source}`);
  }
  return result;
}

function emitShaderExpression(source: string): string {
  const statement = glslStatement(source);
  // Walk the emitter expression dispatch via generateGlslFromShaderStatements
  const glsl = generateGlslFromShaderStatements([statement], 'comp');
  if (glsl === null) {
    throw new Error(`Failed to emit GLSL for: ${source}`);
  }
  return glsl.trim();
}

// ─── Logical Operator Emission ──────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — logical operators', () => {
  test('|| emits a numeric truth predicate', () => {
    const glsl = emitShaderExpression('x = bass || treb');
    expect(glsl).toBe(
      'x = ((abs(signalBass) > 0.000001 || abs(signalTreb) > 0.000001) ? 1.0 : 0.0);',
    );
  });

  test('|| with nested operands emits correct saturating pattern', () => {
    // (a == 1) || (b > 0.5) should emit nested saturating structure
    const glsl = emitShaderExpression('x = (bass == beat) || (mid > 0.5)');
    expect(glsl).toContain('||');
    expect(glsl).toContain('? 1.0 : 0.0');
  });

  test('|| nested with && inside mixes correctly', () => {
    const glsl = emitShaderExpression(
      'x = (bass > 0.5 && mid > 0.3) || (treb > 0.7)',
    );
    expect(glsl).toContain('||');
    expect(glsl).toContain('&&');
  });

  test('|| with literal 0 and 1 stays in range', () => {
    const glsl = emitShaderExpression('x = 1 || 1');
    expect(glsl).toBe(
      'x = ((abs(1.0) > 0.000001 || abs(1.0) > 0.000001) ? 1.0 : 0.0);',
    );
  });

  test('|| with literal 0 and 0 stays at 0', () => {
    const glsl = emitShaderExpression('x = 0 || 0');
    expect(glsl).toBe(
      'x = ((abs(0.0) > 0.000001 || abs(0.0) > 0.000001) ? 1.0 : 0.0);',
    );
  });

  test('&& emits a numeric truth predicate', () => {
    const glsl = emitShaderExpression('x = bass && treb');
    expect(glsl).toBe(
      'x = ((abs(signalBass) > 0.000001 && abs(signalTreb) > 0.000001) ? 1.0 : 0.0);',
    );
  });

  test('&& with literals produces correct product', () => {
    const glsl = emitShaderExpression('x = 1 && 0.5');
    expect(glsl).toBe(
      'x = ((abs(1.0) > 0.000001 && abs(0.5000000000) > 0.000001) ? 1.0 : 0.0);',
    );
  });

  test('! emits boolean NOT via abs-epsilon ternary', () => {
    const glsl = emitShaderExpression('x = !bass');
    expect(glsl).toContain('(abs(signalBass) > 0.000001 ? 0.0 : 1.0)');
  });
});

// ─── Binary Operator Emission ──────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — binary operators', () => {
  test('+ emits addition', () => {
    const glsl = emitShaderExpression('x = bass + treb');
    expect(glsl).toBe('x = (signalBass + signalTreb);');
  });

  test('- emits subtraction', () => {
    const glsl = emitShaderExpression('x = bass - treb');
    expect(glsl).toBe('x = (signalBass - signalTreb);');
  });

  test('* emits multiplication', () => {
    const glsl = emitShaderExpression('x = bass * 2');
    expect(glsl).toBe('x = (signalBass * 2.0);');
  });

  test('/ emits division', () => {
    const glsl = emitShaderExpression('x = bass / 2');
    expect(glsl).toBe('x = (signalBass / 2.0);');
  });

  test('% emits MilkDrop integer modulo without GLSL float modulo', () => {
    const glsl = emitShaderExpression('x = 7.5 % 0.7');
    expect(glsl).toBe('x = milkdropIntMod(7.5000000000, 0.7000000000);');
  });

  test('< emits comparison', () => {
    const glsl = emitShaderExpression('x = bass < 0.5');
    expect(glsl).toBe('x = ((signalBass < 0.5000000000) ? 1.0 : 0.0);');
  });

  test('<= emits a numeric comparison', () => {
    expect(emitShaderExpression('x = bass <= 0.5')).toBe(
      'x = ((signalBass <= 0.5000000000) ? 1.0 : 0.0);',
    );
  });

  test('> emits a numeric comparison', () => {
    expect(emitShaderExpression('x = bass > 0.5')).toBe(
      'x = ((signalBass > 0.5000000000) ? 1.0 : 0.0);',
    );
  });

  test('>= emits comparison', () => {
    const glsl = emitShaderExpression('x = mid >= 0.3');
    expect(glsl).toBe('x = ((signalMid >= 0.3000000000) ? 1.0 : 0.0);');
  });

  test('== emits equality', () => {
    const glsl = emitShaderExpression('x = bass == beat');
    expect(glsl).toBe('x = ((signalBass == signalBeat) ? 1.0 : 0.0);');
  });

  test('!= emits inequality', () => {
    const glsl = emitShaderExpression('x = bass != treb');
    expect(glsl).toBe('x = ((signalBass != signalTreb) ? 1.0 : 0.0);');
  });
});

// ─── Unary Operator Emission ───────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — unary operators', () => {
  test('- negates operand', () => {
    const glsl = emitShaderExpression('x = -bass');
    expect(glsl).toBe('x = -(signalBass);');
  });

  test('+ keeps operand as-is', () => {
    const glsl = emitShaderExpression('x = +bass');
    expect(glsl).toBe('x = signalBass;');
  });
});

// ─── Sampler / Texture Call Emission ───────────────────────────────

describe('milkdrop compiler shader GLSL emitter — sampler calls', () => {
  test('tex2d(sampler_noise, uv).rgb emits aux noise sample', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_noise, uv).rgb');
    expect(glsl).toContain('sampleAuxTexture(');
    expect(glsl).toContain('1.0'); // noise → source ID 1
  });

  test('tex3d(sampler_simplex, vec3(uv, z)).rgb emits aux 3D sample', () => {
    const glsl = emitShaderExpression(
      'ret = tex3d(sampler_simplex, vec3(uv, time * 0.1)).rgb',
    );
    expect(glsl).toContain('sampleAuxTexture(');
    expect(glsl).toContain('2.0'); // simplex → source ID 2
    expect(glsl).toContain('sampleUv(');
  });

  test('tex3d(sampler_simplex, vec3(uv, z)).rgb uses 3D lookup (sampleDim = 1.0)', () => {
    const glsl = emitShaderExpression(
      'ret = tex3d(sampler_simplex, vec3(uv, 0.5)).rgb',
    );
    expect(glsl).toContain('sampleAuxTexture(vec4(2.0, 0, 0, 0).x, 1.0,');
  });

  test('tex3d(sampler_noise, vec3(uv, z)).rgb uses the bundled volume lookup', () => {
    const glsl = emitShaderExpression(
      'ret = tex3d(sampler_noise, vec3(uv, 0.5)).rgb',
    );
    expect(glsl).toContain('sampleAuxTexture(vec4(1.0, 0, 0, 0).x, 1.0,');
  });

  test('texture2d alias normalizes to tex2d', () => {
    const glsl = emitShaderExpression('ret = texture2D(sampler_main, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
  });

  test('texture alias normalizes to tex2d', () => {
    const glsl = emitShaderExpression('ret = texture(sampler_main, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
  });

  test('texture3d alias normalizes to tex3d', () => {
    const glsl = emitShaderExpression(
      'ret = texture3D(sampler_simplex, vec3(uv, 0.5)).rgb',
    );
    expect(glsl).toContain('sampleAuxTexture(');
  });

  test('tex3D(sampler, float3(uv, z)) does not over-pad the coordinate to 4 components', () => {
    // Regression test: float3(uv, z) has a 2-component first argument (the
    // uv coordinate), so it already supplies all 3 vec3 components once
    // combined with z. The generic HLSL float3(x, y) → GLSL vec3(x, y, 0.0)
    // padding (needed for genuine 2-scalar-arg calls) must not also apply
    // here, or the emitted vec3(uv, z, 0.0) has 4 total components and GLSL
    // rejects it as "too many arguments" to the constructor — this broke
    // 261-compshader-noisevol_lq's `tex3D(sampler_fw_noisevol_lq,
    // float3(uv, time / 10.0))`.
    const glsl = emitShaderExpression(
      'ret = tex3D(sampler_simplex, float3(uv, time / 10.0)).xyz',
    );
    expect(glsl).not.toContain('vUv, (signalTime / 10.0), 0.0');
    expect(glsl).toContain('sampleUv(vUv, textureWrap)');
    expect(glsl).toContain('sampleAuxTexture(');
  });

  test('unknown sampler routes through the aux texture fallback', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_gizmo, uv).rgb');
    expect(glsl).toContain('sampleAuxTexture(');
  });
});

// ─── Member Access / Swizzle ───────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — member access', () => {
  test('.x component access passes through', () => {
    const glsl = emitShaderExpression('x = uv.x');
    expect(glsl).toContain('vUv.x');
  });

  test('.y component access passes through', () => {
    const glsl = emitShaderExpression('x = uv.y');
    expect(glsl).toContain('vUv.y');
  });

  test('.r component access passes through', () => {
    const glsl = emitShaderExpression('x = tint.r');
    expect(glsl).toContain('tint.r');
  });

  test('.rg two-component swizzle passes through', () => {
    const glsl = emitShaderExpression('x = tex2d(sampler_main, uv).rg');
    expect(glsl).toContain('.rg');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
  });

  test('accepts repeated and reordered GLSL swizzles', () => {
    expect(emitShaderExpression('x = uv.yx')).toContain('vUv.yx');
    expect(emitShaderExpression('x = vec3(1, 2, 3).zxy')).toContain('.zxy');
    expect(emitShaderExpression('x = vec3(1, 2, 3).xxx')).toContain('.xxx');
    expect(emitShaderExpression('x = vec4(1, 2, 3, 4).bgra')).toContain(
      '.bgra',
    );
  });
});

// ─── Math Function Calls ───────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — math functions', () => {
  test('mix emits GLSL mix', () => {
    const glsl = emitShaderExpression('x = mix(0, 1, 0.5)');
    expect(glsl).toBe('x = mix(0.0, 1.0, 0.5000000000);');
  });

  test('lerp aliases to mix', () => {
    const glsl = emitShaderExpression('x = lerp(0, 1, 0.5)');
    expect(glsl).toBe('x = mix(0.0, 1.0, 0.5000000000);');
  });

  test('sin/cos/tan emit directly', () => {
    expect(emitShaderExpression('x = sin(time)')).toContain('sin(signalTime)');
    expect(emitShaderExpression('x = cos(time)')).toContain('cos(signalTime)');
    expect(emitShaderExpression('x = tan(time)')).toContain('tan(signalTime)');
  });

  test('abs emits directly', () => {
    const glsl = emitShaderExpression('x = abs(-0.5)');
    expect(glsl).toBe('x = abs(-(0.5000000000));');
  });

  test('pow emits GLSL pow', () => {
    const glsl = emitShaderExpression('x = pow(2, 3)');
    expect(glsl).toBe('x = pow(max(0.0, 2.0), 3.0);');
  });

  test('sqrt emits GLSL sqrt', () => {
    const glsl = emitShaderExpression('x = sqrt(4)');
    expect(glsl).toBe('x = sqrt(max(0.0, 4.0));');
  });

  test('clamp emits GLSL clamp', () => {
    const glsl = emitShaderExpression('x = clamp(0.5, 0, 1)');
    expect(glsl).toBe('x = clamp(0.5000000000, 0.0, 1.0);');
  });

  test('step emits GLSL step', () => {
    const glsl = emitShaderExpression('x = step(0.5, 0.7)');
    expect(glsl).toBe('x = step(0.5000000000, 0.7000000000);');
  });

  test('smoothstep emits GLSL smoothstep', () => {
    const glsl = emitShaderExpression('x = smoothstep(0, 1, 0.5)');
    expect(glsl).toBe('x = smoothstep(0.0, 1.0, 0.5000000000);');
  });

  test('min/max emit directly', () => {
    expect(emitShaderExpression('x = min(0, 1)')).toBe('x = min(0.0, 1.0);');
    expect(emitShaderExpression('x = max(0, 1)')).toBe('x = max(0.0, 1.0);');
  });

  test('if emits mix + step pattern', () => {
    const glsl = emitShaderExpression('x = if(cond, a, b)');
    expect(glsl).toContain('mix(');
    expect(glsl).toContain('step(0.0001,');
  });

  test('above/below/equal emit step patterns', () => {
    expect(emitShaderExpression('x = above(a, b)')).toContain('step(');
    expect(emitShaderExpression('x = below(a, b)')).toContain('step(');
    expect(emitShaderExpression('x = equal(a, b)')).toContain('step(');
  });

  test('atan2 emits GLSL atan(y, x)', () => {
    const glsl = emitShaderExpression('x = atan2(y, x)');
    expect(glsl).toContain('atan(');
    expect(glsl).toContain(',');
  });

  test('single-argument atan stays single-argument', () => {
    expect(emitShaderExpression('x = atan(y)')).toBe('x = atan(y);');
  });

  test('log10 lowers to a base-10 logarithm', () => {
    expect(emitShaderExpression('x = log10(y)')).toBe(
      'x = (log(max(y, 0.000001)) * 0.4342944819);',
    );
  });

  test('sqr lowers without leaving an undefined helper', () => {
    expect(emitShaderExpression('x = sqr(y)')).toBe('x = (y * y);');
  });

  test('sigmoid emits exp-based formula', () => {
    const glsl = emitShaderExpression('x = sigmoid(val, slope)');
    expect(glsl).toContain('1.0 / (1.0 + exp(');
  });
});

// ─── Vector Constructors ───────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — vector constructors', () => {
  test('vec2 with two scalars', () => {
    const glsl = emitShaderExpression('x = vec2(1, 2)');
    expect(glsl).toBe('x = vec2(1.0, 2.0);');
  });

  test('vec3 with three scalars', () => {
    const glsl = emitShaderExpression('x = vec3(1, 2, 3)');
    expect(glsl).toBe('x = vec3(1.0, 2.0, 3.0);');
  });

  test('vec4 with four scalars', () => {
    const glsl = emitShaderExpression('x = vec4(1, 2, 3, 4)');
    expect(glsl).toBe('x = vec4(1.0, 2.0, 3.0, 4.0);');
  });

  test('float4 aliases to a GLSL vec4 constructor', () => {
    expect(emitShaderExpression('x = float4(1, 2, 3, 4)')).toBe(
      'x = vec4(1.0, 2.0, 3.0, 4.0);',
    );
  });

  test('float constructor emits GLSL float()', () => {
    const glsl = emitShaderExpression('x = float(0)');
    expect(glsl).toBe('x = float(0.0);');
  });
});

// ─── Caret Exponent Operator → pow() ───────────────────────────────

describe('milkdrop compiler shader GLSL emitter — ^ exponent operator', () => {
  test('^ emits pow() in GLSL (not bitwise XOR)', () => {
    const glsl = emitShaderExpression('x = bass ^ 2.0');
    expect(glsl).toBe('x = pow(signalBass, 2.0);');
  });

  test('^ with complex sub-expressions emits nested pow()', () => {
    const glsl = emitShaderExpression('x = (bass + 1) ^ (treble * 2)');
    expect(glsl).toContain('pow(');
    expect(glsl).toContain('signalBass + 1.0');
    expect(glsl).toContain('signalTreb * 2.0');
  });
});

// ─── Bitwise Operators & and | ───────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — & and | bitwise operators', () => {
  test('& maps to float-int workaround', () => {
    const glsl = emitShaderExpression('x = bass & 2.0');
    expect(glsl).toBe('x = float(int(signalBass) & int(2.0));');
  });

  test('| maps to float-int workaround', () => {
    const glsl = emitShaderExpression('x = mid | 3.0');
    expect(glsl).toBe('x = float(int(signalMid) | int(3.0));');
  });
});

// ─── bassAtt / midAtt / trebleAtt CamelCase Signal Mappings ─────────

describe('milkdrop compiler shader GLSL emitter — camelCase signal aliases', () => {
  test('bassAtt maps to signalBassAtt', () => {
    const glsl = emitShaderExpression('x = bassAtt');
    expect(glsl).toBe('x = signalBassAtt;');
  });

  test('midAtt maps to signalMidAtt', () => {
    const glsl = emitShaderExpression('x = midAtt');
    expect(glsl).toBe('x = signalMidAtt;');
  });

  test('trebleAtt maps to signalTrebAtt', () => {
    const glsl = emitShaderExpression('x = trebleAtt');
    expect(glsl).toBe('x = signalTrebAtt;');
  });

  test('bassAtt used in expression compiles correctly', () => {
    const glsl = emitShaderExpression('x = bassAtt * 2.0');
    expect(glsl).toBe('x = (signalBassAtt * 2.0);');
  });
});

// ─── Identity / Variable Resolution ────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — identifier resolution', () => {
  test('time maps to signalTime', () => {
    const glsl = emitShaderExpression('x = time');
    expect(glsl).toBe('x = signalTime;');
  });

  test('bass maps to signalBass', () => {
    const glsl = emitShaderExpression('x = bass');
    expect(glsl).toBe('x = signalBass;');
  });

  test('pi mapped to constant', () => {
    const glsl = emitShaderExpression('x = pi');
    expect(glsl).toContain('3.14159265359');
  });

  test('e mapped to constant', () => {
    const glsl = emitShaderExpression('x = e');
    expect(glsl).toContain('2.71828182846');
  });

  test('uv maps to vUv', () => {
    const glsl = emitShaderExpression('x = uv');
    expect(glsl).toBe('x = vUv;');
  });

  test('warp maps to warpScale', () => {
    const glsl = emitShaderExpression('x = warp');
    expect(glsl).toBe('x = warpScale;');
  });

  test('zoom maps to zoomMul', () => {
    const glsl = emitShaderExpression('x = zoom');
    expect(glsl).toBe('x = zoomMul;');
  });

  test('rot maps to rotation', () => {
    const glsl = emitShaderExpression('x = rot');
    expect(glsl).toBe('x = rotation;');
  });

  test('feedback_alpha maps to mixAlpha', () => {
    const glsl = emitShaderExpression('x = feedback_alpha');
    expect(glsl).toBe('x = mixAlpha;');
  });
});

// ─── Statement Operators ───────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — statement operators', () => {
  test('= assignment', () => {
    const glsl = emitShaderExpression('x = 42');
    expect(glsl).toBe('x = 42.0;');
  });

  test('+= compound assignment', () => {
    const glsl = emitShaderExpression('x += 42');
    expect(glsl).toBe('x += 42.0;');
  });

  test('-= compound assignment', () => {
    const glsl = emitShaderExpression('x -= 42');
    expect(glsl).toBe('x -= 42.0;');
  });

  test('*= compound assignment', () => {
    const glsl = emitShaderExpression('x *= 2');
    expect(glsl).toBe('x *= 2.0;');
  });

  test('/= compound assignment', () => {
    const glsl = emitShaderExpression('x /= 2');
    expect(glsl).toBe('x /= 2.0;');
  });
});

// ─── Direct Shader Injection ───────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — insertion markers', () => {
  const emptyShaderWithMarkers = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    void main() {
      vec4 color = vec4(0.0);
      // --- DIRECT_WARP_START ---
      // --- DIRECT_WARP_END ---
      // --- DIRECT_COMP_START ---
      // --- DIRECT_COMP_END ---
      gl_FragColor = color;
    }
  `;

  test('injects warp GLSL between warp markers', () => {
    const warpGlsl = '  vUv = vUv * 2.0;';
    const result = injectDirectShaderGlsl(
      emptyShaderWithMarkers,
      warpGlsl,
      null,
    );

    // Warp content appears after the warp start marker
    const warpStart = result.indexOf('// --- DIRECT_WARP_START ---');
    const warpEnd = result.indexOf('// --- DIRECT_WARP_END ---');
    expect(warpStart).toBeGreaterThan(-1);
    expect(warpEnd).toBeGreaterThan(warpStart);
    expect(result.slice(warpStart, warpEnd)).toContain(warpGlsl);
  });

  test('injects comp GLSL between comp markers', () => {
    const compGlsl = '  color.rgb = mix(color.rgb, vec3(1.0), 0.5);';
    const result = injectDirectShaderGlsl(
      emptyShaderWithMarkers,
      null,
      compGlsl,
    );

    const compStart = result.indexOf('// --- DIRECT_COMP_START ---');
    const compEnd = result.indexOf('// --- DIRECT_COMP_END ---');
    expect(compStart).toBeGreaterThan(-1);
    expect(compEnd).toBeGreaterThan(compStart);
    expect(result.slice(compStart, compEnd)).toContain(compGlsl);
  });

  test('injects both warp and comp simultaneously', () => {
    const warpGlsl = '  vUv += 0.01;';
    const compGlsl = '  color *= 1.2;';
    const result = injectDirectShaderGlsl(
      emptyShaderWithMarkers,
      warpGlsl,
      compGlsl,
    );

    expect(result).toContain(warpGlsl);
    expect(result).toContain(compGlsl);
  });

  test('skips injection when marker missing and shader unchanged', () => {
    const noMarkers = 'void main() { gl_FragColor = vec4(1.0); }';
    const result = injectDirectShaderGlsl(noMarkers, 'x = 1;', null);
    expect(result).toBe(noMarkers);
  });
});

// ─── Variant Tag Generation ────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — variant tag', () => {
  test('both warp and comp produce -direct-dw-dc tag', () => {
    expect(generateShaderVariantTag('x = 1;', 'y = 2;')).toBe('-direct-dw-dc');
  });

  test('only warp produces -direct-dw', () => {
    expect(generateShaderVariantTag('x = 1;', null)).toBe('-direct-dw');
  });

  test('only comp produces -direct-dc', () => {
    expect(generateShaderVariantTag(null, 'y = 2;')).toBe('-direct-dc');
  });

  test('neither produces empty string', () => {
    expect(generateShaderVariantTag(null, null)).toBe('');
  });
});

// ─── Round-trip: Parse + Emit ─────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — round-trip', () => {
  test('complex expression with mix, samples, and logic', () => {
    const source =
      'ret = mix(tex2d(sampler_main, uv).rgb, tex2d(sampler_noise, uv).rgb, bass)';
    const glsl = emitShaderExpression(source);
    // Should contain both main and noise samples
    expect(glsl).toContain('currentTex');
    expect(glsl).toContain('sampleAuxTexture');
    expect(glsl).toContain('mix(');
    expect(glsl).toContain('signalBass');
  });

  test('chained || and && mixed precedence', () => {
    const source = 'x = (a && b) || (c && d)';
    const glsl = emitShaderExpression(source);
    expect(glsl).toContain(' || ');
    expect(glsl).toContain(' && ');
    expect(glsl).toContain('? 1.0 : 0.0');
  });

  test('negated texture sample', () => {
    const source = 'ret = !tex2d(sampler_main, uv).rgb';
    const glsl = emitShaderExpression(source);
    expect(glsl).toContain('abs(');
    expect(glsl).toContain('> 0.000001 ? 0.0 : 1.0)');
  });

  test('no-op identity sample', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_main, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
    expect(glsl).toContain(', textureWrap)).rgb');
  });
});

// ─── Extended HLSL Intrinsics ─────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — extended intrinsics', () => {
  test('tex2Dlod unwraps the HLSL float4 coordinate into textureLod', () => {
    const glsl = emitShaderExpression(
      'ret = tex2Dlod(sampler_main, float4(uv, 0.0, 0.0, 2.0)).rgb',
    );
    expect(glsl).toContain(
      'textureLod(currentTex, sampleUv(vec2(vUv, 0.0), textureWrap), 2.0).rgb',
    );
  });

  test('tex2Dbias emits texture() with an explicit bias', () => {
    const glsl = emitShaderExpression(
      'ret = tex2Dbias(sampler_noise, float4(uv, 0.0, 0.0, 0.5)).rgb',
    );
    expect(glsl).toContain(
      'texture(noiseTex, sampleUv(vec2(vUv, 0.0), textureWrap), 0.5000000000)',
    );
  });

  test('tex2Dgrad emits textureGrad with explicit gradients', () => {
    const glsl = emitShaderExpression(
      'ret = tex2Dgrad(sampler_main, uv, dFdx(vUv), dFdy(vUv)).rgb',
    );
    expect(glsl).toContain(
      'textureGrad(currentTex, sampleUv(vUv, textureWrap), dFdx(vUv), dFdy(vUv))',
    );
  });

  test('tex2Dlod on a sampler without a mip chain falls back to base mip', () => {
    // fw_noise_lq is procedural; the fallback keeps the emit valid.
    const glsl = emitShaderExpression(
      'ret = tex2Dlod(sampler_fw_noise_lq, float4(uv, 0.0, 0.0, 2.0)).rgb',
    );
    expect(glsl).toContain('vec3(noise(');
  });

  test('emits the scalar/vector derivative and pow2 helpers', () => {
    expect(emitShaderExpression('x = fwidth(bass)')).toContain(
      'fwidth(signalBass)',
    );
    expect(emitShaderExpression('x = exp2(bass)')).toContain(
      'exp2(signalBass)',
    );
    expect(emitShaderExpression('x = log2(bass)')).toContain(
      'log2(max(signalBass, 0.000001))',
    );
    expect(emitShaderExpression('x = rsqrt(bass)')).toContain(
      'inversesqrt(max(signalBass, 0.000001))',
    );
  });

  test('emits the remaining math intrinsics with guarded domains', () => {
    expect(emitShaderExpression('x = trunc(bass)')).toContain(
      'trunc(signalBass)',
    );
    expect(emitShaderExpression('x = round(bass)')).toContain(
      'round(signalBass)',
    );
    expect(
      emitShaderExpression('x = reflect(vec3(0,1,0), vec3(0,1,0))'),
    ).toContain('reflect(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0))');
    expect(
      emitShaderExpression('x = refract(vec3(0,1,0), vec3(0,1,0), 1.0)'),
    ).toContain('refract(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), 1.0)');
    expect(emitShaderExpression('x = transpose(mat3(1))')).toContain(
      'transpose(',
    );
  });

  test('half*/int/bool constructors lower to GLSL built-ins', () => {
    expect(emitShaderExpression('x = half(bass)')).toContain(
      'float(signalBass)',
    );
    expect(emitShaderExpression('x = half2(bass, 1)')).toContain(
      'vec2(signalBass, 1.0)',
    );
    expect(emitShaderExpression('x = half3(uv, 1.0)')).toContain(
      'vec3(vUv, 1.0)',
    );
    expect(emitShaderExpression('x = int(bass)')).toContain('int(signalBass)');
    expect(emitShaderExpression('x = bool(bass)')).toContain(
      'bool(signalBass)',
    );
  });

  test('routes perlin/glyph/organic aux samplers to their own source ids', () => {
    expect(
      emitShaderExpression('ret = tex2d(sampler_perlin, uv).rgb'),
    ).toContain('sampleAuxTexture(vec4(9.0, 0, 0, 0).x');
    expect(
      emitShaderExpression('ret = tex2d(sampler_glyph, uv).rgb'),
    ).toContain('sampleAuxTexture(vec4(12.0, 0, 0, 0).x');
    expect(
      emitShaderExpression('ret = tex2d(sampler_organic, uv).rgb'),
    ).toContain('sampleAuxTexture(vec4(13.0, 0, 0, 0).x');
  });

  test('keeps blur samplers on their dedicated blur textures', () => {
    expect(
      emitShaderExpression('ret = tex2d(sampler_blur1, uv).rgb'),
    ).toContain('texture2D(blur1Tex, sampleUv(vUv, textureWrap)).rgb');
  });
});

// ─── MilkDrop 2 preamble helpers ────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — MilkDrop 2 helpers', () => {
  // MilkDrop 2 ships GetPixel/GetBlurN in its shader preamble, so preset
  // bodies call them without defining them. They were unimplemented here,
  // which failed the whole program to compile and rendered the preset black —
  // 511 presets, the entire projectm-cream-of-the-crop library.
  test('GetPixel samples the main texture', () => {
    expect(emitShaderExpression('ret = GetPixel(uv)')).toBe(
      'ret = vec3(texture2D(currentTex, sampleUv(vUv, textureWrap)).xyz);',
    );
  });

  test('GetBlur1/2/3 sample their blur texture through scale and bias', () => {
    expect(emitShaderExpression('ret = GetBlur1(uv)')).toContain(
      '(texture2D(blur1Tex, sampleUv(vUv, textureWrap)).xyz * scale1 + bias1)',
    );
    expect(emitShaderExpression('ret = GetBlur2(uv)')).toContain(
      '(texture2D(blur2Tex, sampleUv(vUv, textureWrap)).xyz * scale2 + bias2)',
    );
    expect(emitShaderExpression('ret = GetBlur3(uv)')).toContain(
      '(texture2D(blur3Tex, sampleUv(vUv, textureWrap)).xyz * scale3 + bias3)',
    );
  });

  test('GetBlur0 is an alias for the unblurred main sample', () => {
    expect(emitShaderExpression('ret = GetBlur0(uv)')).toBe(
      emitShaderExpression('ret = GetPixel(uv)'),
    );
  });

  test('helper names are case-insensitive, as MilkDrop writes them', () => {
    expect(emitShaderExpression('ret = getblur1(uv)')).toBe(
      emitShaderExpression('ret = GetBlur1(uv)'),
    );
  });
});

// ─── HLSL scalar promotion ──────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — scalar promotion', () => {
  // HLSL broadcasts a scalar across every component on assignment; GLSL
  // rejects it outright. `ret` is vec3 in both stage templates.
  test('a scalar assigned to ret is broadcast, not rejected', () => {
    expect(emitShaderExpression('ret = GetPixel(uv).x')).toBe(
      'ret = vec3(texture2D(currentTex, sampleUv(vUv, textureWrap)).xyz.x);',
    );
  });
});

// ─── texsize resolution ─────────────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — texsize', () => {
  // Statement-emitted programs never pass through the raw-text rewrite chain,
  // so texsize identifiers reached the shader bare and were auto-declared as
  // `uniform float` — making every `texsize.xy` a scalar swizzle error.
  test('texsize resolves to the feedback target size as a vec4', () => {
    expect(emitShaderExpression('x = texsize.xy')).toContain(
      'vec4(1.0 / texelSize, texelSize).xy',
    );
  });

  test('noise texsize resolves to the bundled 256x256 size', () => {
    expect(emitShaderExpression('x = texsize_noise_lq.zw')).toContain(
      'vec4(256.0, 256.0, 0.00390625, 0.00390625).zw',
    );
  });

  test('an unknown custom-texture texsize falls back to the substitute size', () => {
    expect(emitShaderExpression('x = texsize_mcode1.xy')).toContain(
      'vec4(640.0, 640.0, 0.0015625, 0.0015625).xy',
    );
  });
});

// ─── Preset-declared locals ─────────────────────────────────────────

describe('preset-declared locals', () => {
  function emitProgram(sources: string[]): string {
    const glsl = generateGlslFromShaderStatements(
      sources.map(glslStatement),
      'comp',
    );
    if (glsl === null) throw new Error('Failed to emit GLSL');
    return glsl;
  }

  test("carries a preset's declared vector type into the emitted GLSL", () => {
    const glsl = emitProgram(['float2 uv_y = uv - 0.25']);

    // Without the declaration the assembled shader infers the type from the
    // assignment text, which only recognises a bare vecN( constructor — so a
    // parenthesised or arithmetic RHS became `float uv_y;` and every later use
    // failed to compile.
    expect(glsl).toContain('vec2 uv_y =');
  });

  test('broadcasts a scalar into a declared vector, as HLSL does', () => {
    const glsl = emitProgram(['float3 dots = 0.5']);

    expect(glsl).toContain('vec3 dots = vec3(');
  });

  test('declares a name once, however many times it is assigned', () => {
    const glsl = emitProgram(['float3 acc = 0.5', 'acc = 0.25']);

    expect(glsl.match(/vec3 acc =/g)).toHaveLength(1);
    expect(glsl).toContain('acc = 0.25');
  });

  // `ret` and `uv` are declared by the stage templates and read back after the
  // body. Shadowing either with a local means the template reads a value the
  // body never wrote — a black frame rather than a compile error.
  test('never re-declares a target the stage template owns', () => {
    const glsl = emitProgram(['float3 ret = 0.5', 'float2 uv = 0.25']);

    expect(glsl).not.toContain('vec3 ret =');
    expect(glsl).not.toContain('vec2 uv =');
  });

  // A preset may name a local after a shader control (`b`, `mix`, `sat`, …).
  // Rewriting reads of it to the uniform is not a compile error, it is a
  // silently wrong picture, so the declaration has to win.
  test('a declared local wins over the uniform alias of the same name', () => {
    const glsl = emitProgram(['float3 b = 0.5', 'ret = b']);

    expect(glsl).toContain('vec3 b = vec3(');
    expect(glsl).toContain('ret = vec3(b)');
    expect(glsl).not.toContain('colorScale.b');
  });

  test('still aliases a control the preset did not declare', () => {
    const glsl = emitProgram(['ret = b']);

    expect(glsl).toContain('colorScale.b');
  });
});
