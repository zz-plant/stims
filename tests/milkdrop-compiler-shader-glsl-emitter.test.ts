import { describe, expect, test } from 'bun:test';
import {
  generateGlslFromShaderStatements,
  generateShaderVariantTag,
  injectDirectShaderGlsl,
} from '../assets/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { parseMilkdropShaderStatement } from '../assets/js/milkdrop/shader-ast.ts';
import type { MilkdropShaderStatement } from '../assets/js/milkdrop/types.ts';

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
  test('|| emits saturating OR via a+b-ab', () => {
    // bass || treb → (signalBass + signalTreb - signalBass * signalTreb)
    const glsl = emitShaderExpression('x = bass || treb');
    expect(glsl).toContain('signalBass + signalTreb - signalBass * signalTreb');
    expect(glsl).not.toMatch(/signalBass\s*\+\s*signalTreb\s*\)\s*$/);
  });

  test('|| with nested operands emits correct saturating pattern', () => {
    // (a == 1) || (b > 0.5) should emit nested saturating structure
    const glsl = emitShaderExpression('x = (bass == beat) || (mid > 0.5)');
    expect(glsl).toContain(' - ');
    expect(glsl).toContain(' * ');
  });

  test('|| nested with && inside mixes correctly', () => {
    const glsl = emitShaderExpression(
      'x = (bass > 0.5 && mid > 0.3) || (treb > 0.7)',
    );
    expect(glsl).toContain(' - ');
    expect(glsl).toContain(' * ');
    // Inner && should use * for AND
    expect(glsl).toContain('*');
  });

  test('|| with literal 0 and 1 stays in range', () => {
    // 1 || 1 → 1 + 1 - 1*1 = 1 (correctly saturated)
    const glsl = emitShaderExpression('x = 1 || 1');
    expect(glsl).toBe('x = (1.0 + 1.0 - 1.0 * 1.0);');
  });

  test('|| with literal 0 and 0 stays at 0', () => {
    const glsl = emitShaderExpression('x = 0 || 0');
    expect(glsl).toBe('x = (0.0 + 0.0 - 0.0 * 0.0);');
  });

  test('&& emits multiplication-based AND', () => {
    const glsl = emitShaderExpression('x = bass && treb');
    expect(glsl).toContain('signalBass * signalTreb');
    expect(glsl).not.toContain(' + ');
  });

  test('&& with literals produces correct product', () => {
    const glsl = emitShaderExpression('x = 1 && 0.5');
    expect(glsl).toBe('x = (1.0 * 0.5000000000);');
  });

  test('! emits subtraction from 1.0', () => {
    const glsl = emitShaderExpression('x = !bass');
    expect(glsl).toContain('(1.0 - (signalBass))');
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

  test('< emits comparison', () => {
    const glsl = emitShaderExpression('x = bass < 0.5');
    expect(glsl).toBe('x = (signalBass < 0.5000000000);');
  });

  test('>= emits comparison', () => {
    const glsl = emitShaderExpression('x = mid >= 0.3');
    expect(glsl).toBe('x = (signalMid >= 0.3000000000);');
  });

  test('== emits equality', () => {
    const glsl = emitShaderExpression('x = bass == beat');
    expect(glsl).toBe('x = (signalBass == signalBeat);');
  });

  test('!= emits inequality', () => {
    const glsl = emitShaderExpression('x = bass != treb');
    expect(glsl).toBe('x = (signalBass != signalTreb);');
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
  test('tex2d(sampler_main, uv).rgb emits main texture sample', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_main, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
    expect(glsl).toContain('textureWrap');
  });

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

  test('unknown sampler falls back to main texture', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_gizmo, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
  });
});

// ─── Member Access / Swizzle ───────────────────────────────────────

describe('milkdrop compiler shader GLSL emitter — member access', () => {
  test('.rgb swizzle passes through', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_main, uv).rgb');
    expect(glsl).toContain('.rgb');
  });

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
    expect(glsl).toBe('x = pow(2.0, 3.0);');
  });

  test('sqrt emits GLSL sqrt', () => {
    const glsl = emitShaderExpression('x = sqrt(4)');
    expect(glsl).toBe('x = sqrt(4.0);');
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

  test('float constructor emits GLSL float()', () => {
    const glsl = emitShaderExpression('x = float(0)');
    expect(glsl).toBe('x = float(0.0);');
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
    // Outer || → saturating a+b-ab where each term is a product
    expect(glsl).toContain(' + ');
    expect(glsl).toContain(' - ');
    expect(glsl).toContain(' * ');
  });

  test('negated texture sample', () => {
    const source = 'ret = !tex2d(sampler_main, uv).rgb';
    const glsl = emitShaderExpression(source);
    expect(glsl).toContain('1.0 - (texture2D(');
    expect(glsl).toContain('.rgb))');
  });

  test('no-op identity sample', () => {
    const glsl = emitShaderExpression('ret = tex2d(sampler_main, uv).rgb');
    expect(glsl).toContain('texture2D(currentTex, sampleUv(');
    expect(glsl).toContain(', textureWrap)).rgb');
  });
});
