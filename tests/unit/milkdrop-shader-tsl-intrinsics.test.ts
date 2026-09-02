import { describe, expect, test } from 'bun:test';
import { Texture } from 'three';
import { getCurrentStack, setCurrentStack, stack, vec2 } from 'three/tsl';
import {
  compileShaderExpressionNode,
  runShaderProgram,
} from '../../src/js/milkdrop/feedback-manager-webgpu.ts';
import {
  createCompositeUniforms,
  createSampleAuxTextureNode,
  createSampleUvNode,
} from '../../src/js/milkdrop/feedback-manager-webgpu-composite.ts';
import type { ShaderNodeEnv } from '../../src/js/milkdrop/feedback-manager-webgpu-tsl.ts';
import { parseMilkdropShaderStatement } from '../../src/js/milkdrop/shader-ast.ts';

function buildShaderEnv() {
  const aux = {
    noise: new Texture(),
    perlin: new Texture(),
    simplex: new Texture(),
    voronoi: new Texture(),
    aura: new Texture(),
    caustics: new Texture(),
    pattern: new Texture(),
    fractal: new Texture(),
    video: new Texture(),
  };
  const uniforms = createCompositeUniforms(new Texture(), new Texture(), aux);
  const sampleUvNode = createSampleUvNode();
  // Narrowed the same way production does (see `createCompositeAuxSampler`):
  // the factory's inferred return widens to `Node<'float' | 'vec4'>` across
  // its ~15-branch select chain, and ShaderNodeEnv declares the vec4 that
  // every branch actually builds.
  const sampleAuxTextureNode = createSampleAuxTextureNode(
    uniforms.noiseTex,
    uniforms.perlinTex,
    uniforms.simplexTex,
    uniforms.voronoiTex,
    uniforms.auraTex,
    uniforms.causticsTex,
    uniforms.patternTex,
    uniforms.fractalTex,
    uniforms.videoTex,
    uniforms.glyphTex,
    uniforms.organicTex,
    uniforms.noiseLqTex,
    uniforms.noisevolTex,
    uniforms.blur1Tex,
    uniforms.blur2Tex,
    uniforms.blur3Tex,
    {
      noise: uniforms.noiseTex3D,
      simplex: uniforms.simplexTex3D,
      voronoi: uniforms.voronoiTex3D,
      aura: uniforms.auraTex3D,
      caustics: uniforms.causticsTex3D,
      pattern: uniforms.patternTex3D,
      fractal: uniforms.fractalTex3D,
      perlin: uniforms.perlinTex3D,
      noisevol: uniforms.noisevolTex3D,
    },
  );
  return {
    values: new Map<string, { kind: 'vec2'; node: unknown }>([
      ['uv', { kind: 'vec2', node: { x: 0, y: 0 } }],
    ]),
    uniforms,
    sampleUvNode,
    sampleAuxTextureNode:
      sampleAuxTextureNode as unknown as ShaderNodeEnv['sampleAuxTextureNode'],
  } as const;
}

/**
 * Node the swizzle in a compiled texture read is taken from. A direct fetch
 * leaves a TextureNode/Texture3DNode here; a read routed through an inlined
 * TSL `Fn` leaves that function's VarNode instead.
 */
function sampledNodeType(value: unknown) {
  const node = (value as { node?: { node?: object } } | null)?.node?.node;
  return node?.constructor?.name ?? null;
}

function compileExpression(source: string) {
  const statement = parseMilkdropShaderStatement(source);
  if (!statement) {
    throw new Error(`Failed to parse: ${source}`);
  }
  return compileShaderExpressionNode(statement.expression, buildShaderEnv());
}

describe('milkdrop WebGPU TSL extended intrinsics', () => {
  test('builds nodes for the extended math intrinsics', () => {
    for (const source of [
      'x = tan(0.5)',
      'x = ceil(0.5)',
      'x = sign(-0.5)',
      'x = exp(0.5)',
      'x = exp2(0.5)',
      'x = log(0.5)',
      'x = log2(0.5)',
      'x = rsqrt(0.5)',
      'x = trunc(0.5)',
      'x = round(0.5)',
      'x = fwidth(0.5)',
      'x = ddx(0.5)',
      'x = ddy(0.5)',
      'x = asin(0.5)',
      'x = acos(0.5)',
      'x = atan(0.5)',
      'x = atan2(0.5, 0.5)',
      'x = saturate(0.5)',
      'x = float(0.5)',
      'x = int(0.5)',
      'x = bool(0.5)',
      'x = half(0.5)',
    ]) {
      const value = compileExpression(source);
      expect(value, source).not.toBeNull();
      expect(value?.kind, source).toBe('scalar');
    }
  });

  test('builds nodes for vector math intrinsics', () => {
    const normalizeValue = compileExpression(
      'x = normalize(vec3(0.0, 1.0, 0.0))',
    );
    expect(normalizeValue?.kind).toBe('vec3');

    const crossValue = compileExpression(
      'x = cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))',
    );
    expect(crossValue?.kind).toBe('vec3');

    const reflectValue = compileExpression(
      'x = reflect(vec3(0.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0))',
    );
    expect(reflectValue?.kind).toBe('vec3');

    const refractValue = compileExpression(
      'x = refract(vec3(0.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0), 1.0)',
    );
    expect(refractValue?.kind).toBe('vec3');
  });

  test('builds a vec3 node for sampleNoiseVolume volume sampling', () => {
    const value = compileExpression(
      'x = sampleNoiseVolume(vec3(0.1, 0.2, 0.3))',
    );
    expect(value).not.toBeNull();
    expect(value?.kind).toBe('vec3');
  });

  test('builds tex2Dlod/tex2Dbias/tex2Dgrad nodes against direct textures', () => {
    const lod = compileExpression(
      'x = tex2Dlod(sampler_main, vec4(0.5, 0.5, 0.0, 2.0))',
    );
    expect(lod?.kind).toBe('vec3');

    const bias = compileExpression(
      'x = tex2Dbias(sampler_noise, vec4(0.5, 0.5, 0.0, 0.5))',
    );
    expect(bias?.kind).toBe('vec3');

    const grad = compileExpression(
      'x = tex2Dgrad(sampler_main, uv, vec2(0.1, 0.0), vec2(0.0, 0.1))',
    );
    expect(grad?.kind).toBe('vec3');
  });

  test('resolves rewritten texture identifiers to canonical sampler bindings', () => {
    const current = compileExpression('x = tex2d(currentTex, uv)');
    expect(current?.kind).toBe('vec3');

    const blur = compileExpression('x = tex2d(blur1Tex, uv)');
    expect(blur?.kind).toBe('vec3');

    const warp = compileExpression('x = tex2d(warpTex, uv)');
    expect(warp?.kind).toBe('vec3');

    const simplex = compileExpression('x = tex2d(simplexTex, uv)');
    expect(simplex?.kind).toBe('vec3');
  });

  test('still rejects unknown calls instead of silently building', () => {
    expect(compileExpression('x = unknownIntrinsic(1.0)')).toBeNull();
  });

  /**
   * One texture read in a shader body must fetch ONE texture.
   *
   * The aux sampler also has a runtime-selected form, which carries every
   * slot's fetch behind a `select` chain — sixteen 2D textures, ten 3D ones,
   * and video's two-slice atlas blend. TSL inlines it at each call site, so
   * routing a body's reads through it cost ~58 `textureSample` calls apiece:
   * the four-statement composite prefix of
   * flexi-lorenz-chaser-...-discombobule-lose compiled to 451 of them in
   * 367 KB of WGSL and killed the GPU process inside Dawn's shader compiler,
   * with no WebGPU validation error to say why.
   *
   * A body names its sampler in its own text, so counting texture nodes is
   * the cheap invariant that catches a regression here without a GPU: a
   * single read that reaches the runtime chain again jumps back into the
   * dozens.
   */
  test('a shader body texture read fetches one texture, not every slot', () => {
    for (const source of [
      'x = texture(sampler_blur1, uv)',
      'x = texture(sampler_blur3, uv)',
      'x = texture(sampler_noise, uv)',
      'x = tex2d(simplexTex, uv)',
      'x = tex3D(sampler_noisevol, vec3(0.1, 0.2, 0.3))',
    ]) {
      const value = compileExpression(source);
      expect(value, source).not.toBeNull();
      expect(sampledNodeType(value), source).toMatch(/^Texture(3D)?Node$/);
    }
  });
});

describe('milkdrop WebGPU TSL mat2 element writes', () => {
  // The shader-analysis gate lets `mat2` element writes through to this
  // executor (only `mat3`/`mat4` writes are held back — see
  // isUnexecutableMatrixElementAssignment in compiler/shader-analysis.ts),
  // so every form the bundled corpus uses has to build a node here rather
  // than silently drop the statement: column writes, component writes on a
  // bare-declared matrix, matrix products in both orders, and the mat2
  // constructor. 87 of the 107 gap presets with matrix writes are mat2-only.
  function runBody(lines: string[]) {
    const env = buildShaderEnv() as unknown as ShaderNodeEnv;
    // The shared env seeds `uv` with a placeholder object, which is enough
    // for the intrinsic tests above but not for arithmetic on it.
    env.values.set('uv', { kind: 'vec2', node: vec2(0.25, 0.75) });
    env.unresolvedNames = new Set<string>();
    const statements = lines.map((line) => {
      const statement = parseMilkdropShaderStatement(line);
      if (!statement) {
        throw new Error(`Failed to parse: ${line}`);
      }
      return statement;
    });
    // Component writes go through TSL `.toVar().assign()`, which needs the
    // stack a `Fn()` body provides in production; open one here.
    const previous = getCurrentStack();
    setCurrentStack(stack());
    try {
      runShaderProgram(statements, env);
    } finally {
      setCurrentStack(previous);
    }
    return env;
  }

  test('binds a per-frame register read as a uniform, never a scratch local', () => {
    // martin-adrift-on-a-dead-planet-lard-mix reads `tele` and `hordist`
    // in its warp body: per_frame code writes them, the shader only reads
    // them. WebGL declares those as `uniform float`; the executor has to
    // bind them too, or the statements silently vanish. A name the body
    // assigns before reading is its own scratch variable and must not become
    // a uniform, and a sampler identifier must not either.
    const env = runBody([
      'xlat_mutableuv2 = ((uv * aspect.xy) * tele)',
      'tmpvar_7 = (32.0 * hordist)',
      'foo = 1.0',
      'foo = (foo + tmpvar_7)',
      'ret_1 = texture2D(currentTex, xlat_mutableuv2).xyz',
      'ret = (ret_1 * foo)',
    ]);
    const bound = env.uniforms.perFrameVariables as Map<string, unknown>;
    expect([...bound.keys()].sort()).toEqual(['hordist', 'tele']);
    // The diagnostics set also records first-write base lookups and sampler
    // identifiers by design; what must not be there is a bound register.
    expect(env.unresolvedNames?.has('tele')).toBe(false);
    expect(env.unresolvedNames?.has('hordist')).toBe(false);
    expect(env.values.get('ret')?.kind).toBe('vec3');
  });

  test('builds a mat2 column by column and multiplies uv through it', () => {
    const env = runBody([
      'tmpvar_16[int(0)] = vec2(1.0, 0.0)',
      'tmpvar_16[1] = vec2(0.0, 1.0)',
      'xlat_mutableuv6 = (uv * tmpvar_16)',
      'ret = vec3(xlat_mutableuv6, 0.0)',
    ]);
    expect(env.values.get('tmpvar_16')?.kind).toBe('mat2');
    expect(env.values.get('xlat_mutableuv6')?.kind).toBe('vec2');
    expect(env.values.get('ret')?.kind).toBe('vec3');
  });

  test('builds a mat2 component by component from a bare declaration', () => {
    // `mat2 tmpvar_13;` carries no statement; the first component write has
    // to materialise the matrix on its own.
    const env = runBody([
      'tmpvar_13[int(0)].x = 1.0',
      'tmpvar_13[int(0)].y = -0.0',
      'tmpvar_13[1].x = 0.0',
      'tmpvar_13[1].y = 1.0',
      'xlat_mutablerss = (tmpvar_13 * mat2(0.7, -0.7, 0.7, 0.7))',
      'zz_1 = (((uv - vec2(0.5, 0.5)) * 0.01) * xlat_mutablerss)',
      'ofs = (tmpvar_13 * 2.0)',
      'ret = vec3(zz_1, ofs[int(0)].x)',
    ]);
    expect(env.values.get('tmpvar_13')?.kind).toBe('mat2');
    expect(env.values.get('xlat_mutablerss')?.kind).toBe('mat2');
    expect(env.values.get('zz_1')?.kind).toBe('vec2');
    expect(env.values.get('ofs')?.kind).toBe('mat2');
    expect(env.values.get('ret')?.kind).toBe('vec3');
  });
});

describe('milkdrop WebGPU TSL mat3/mat4 element writes', () => {
  // A mat3/mat4 is carried as its column vectors (see shaderMatrix), so an
  // element write is a swizzle on one column and a product is spelled out on
  // the columns. Shader analysis seeds every bare `matN name;` declaration
  // with `name = matN(0.0)`, which is how the executor learns the size before
  // the first `name[int(0)].x = …` arrives; the bodies here start the same
  // way. Every form comes from the bundled corpus: 20 presets build a mat3
  // rotation from q20..q28 and apply it as `(p / q7) * M`.
  function runBody(lines: string[]) {
    const env = buildShaderEnv() as unknown as ShaderNodeEnv;
    env.values.set('uv', { kind: 'vec2', node: vec2(0.25, 0.75) });
    env.unresolvedNames = new Set<string>();
    const statements = lines.map((line) => {
      const statement = parseMilkdropShaderStatement(line);
      if (!statement) {
        throw new Error(`Failed to parse: ${line}`);
      }
      return statement;
    });
    const previous = getCurrentStack();
    setCurrentStack(stack());
    try {
      runShaderProgram(statements, env);
    } finally {
      setCurrentStack(previous);
    }
    return env;
  }

  test('builds a mat3 component by component and applies it as a row-vector product', () => {
    // martin-castle-in-the-air's warp body, reduced: nine element writes on
    // the seeded matrix, then `(p / q7) * M` and a whole-matrix read.
    const env = runBody([
      'tmpvar_1 = mat3(0.0)',
      'tmpvar_1[int(0)].x = q20',
      'tmpvar_1[int(0)].y = q23',
      'tmpvar_1[int(0)].z = q26',
      'tmpvar_1[1].x = q21',
      'tmpvar_1[1].y = q24',
      'tmpvar_1[1].z = q27',
      'tmpvar_1[2].x = q22',
      'tmpvar_1[2].y = q25',
      'tmpvar_1[2].z = q28',
      'tmpvar_19 = vec3(uv, 0.5)',
      'xlat_mutableuv2 = (((tmpvar_19 / q7) * tmpvar_1) + vec3(q4, q5, q6))',
      'column_2 = tmpvar_1[1]',
      'element_3 = tmpvar_1[2].y',
      'ret = (xlat_mutableuv2 + (column_2 * element_3))',
    ]);
    expect(env.values.get('tmpvar_1')?.kind).toBe('mat3');
    expect(env.values.get('tmpvar_1')?.columns).toHaveLength(3);
    expect(env.values.get('xlat_mutableuv2')?.kind).toBe('vec3');
    expect(env.values.get('column_2')?.kind).toBe('vec3');
    expect(env.values.get('element_3')?.kind).toBe('scalar');
    expect(env.values.get('ret')?.kind).toBe('vec3');
    // Nothing fell back to a per-frame register: every name was resolved.
    const bound = env.uniforms.perFrameVariables as Map<string, unknown>;
    expect([...bound.keys()]).toEqual([]);
  });

  test('multiplies mat3 by vec3, mat3 by mat3 and by a scalar, and transposes', () => {
    const env = runBody([
      'rot_1 = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)',
      'scale_2 = mat3(2.0)',
      'combined_3 = (rot_1 * scale_2)',
      'scaled_4 = (combined_3 * 0.5)',
      'flipped_5 = transpose(scaled_4)',
      'summed_6 = (flipped_5 + rot_1)',
      'point_7 = (summed_6 * vec3(uv, 1.0))',
      'hlsl_8 = mul(vec3(uv, 1.0), summed_6)',
      'ret = (point_7 + hlsl_8)',
    ]);
    for (const name of [
      'rot_1',
      'scale_2',
      'combined_3',
      'scaled_4',
      'flipped_5',
      'summed_6',
    ]) {
      expect(env.values.get(name)?.kind).toBe('mat3');
    }
    expect(env.values.get('point_7')?.kind).toBe('vec3');
    expect(env.values.get('hlsl_8')?.kind).toBe('vec3');
    expect(env.values.get('ret')?.kind).toBe('vec3');
  });

  test('builds a mat4 from columns and reads a column at a runtime index', () => {
    // martin-city-of-shadows indexes a constant mat4 with `int(mod(…))` on
    // both axes; a column the executor cannot name at build time goes
    // through element access instead of being dropped.
    const env = runBody([
      'basis_1 = mat4(0.0)',
      'basis_1[int(0)] = vec4(1.0, 0.0, 0.0, 0.0)',
      'basis_1[3].w = 1.0',
      'cell_2 = (uv * 4.0)',
      'mod1_3 = mat4(0.0, 0.9, 0.3, -1.2, 0.6, 0.0, -0.9, 0.3, 0.3, 0.3, 0.6, 0.6, -1.2, 1.5, -1.2, 0.0)[int(mod(cell_2.y, 4.0))][int(mod(cell_2.x, 4.0))]',
      'column_4 = basis_1[int(mod(cell_2.x, 4.0))]',
      'ret = (vec3(column_4.xyz) * mod1_3)',
    ]);
    expect(env.values.get('basis_1')?.kind).toBe('mat4');
    expect(env.values.get('basis_1')?.columns).toHaveLength(4);
    expect(env.values.get('mod1_3')?.kind).toBe('scalar');
    expect(env.values.get('column_4')?.kind).toBe('vec4');
    expect(env.values.get('ret')?.kind).toBe('vec3');
    // The diagnostics set also records first-write base lookups by design;
    // what must not happen is a name falling through to a per-frame register.
    const bound = env.uniforms.perFrameVariables as Map<string, unknown>;
    expect([...bound.keys()]).toEqual([]);
  });

  test('ignores an element write past the matrix size instead of corrupting it', () => {
    const env = runBody([
      'basis_1 = mat3(0.0)',
      'basis_1[3].x = 1.0',
      'basis_1[int(0)].w = 1.0',
      'ret = (basis_1 * vec3(uv, 1.0))',
    ]);
    expect(env.values.get('basis_1')?.kind).toBe('mat3');
    expect(env.values.get('ret')?.kind).toBe('vec3');
  });
});
