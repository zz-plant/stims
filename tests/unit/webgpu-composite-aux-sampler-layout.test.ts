/**
 * The composite's aux-texture sampler is a TSL layout Fn (one WGSL function
 * instead of a 16-branch chain inlined at 25 sites). Three caches a layout
 * function's generated code per Fn instance for the life of the backend,
 * which is only sound for a pure function of its inputs — this one captures
 * texture bindings and their uv-matrix uniforms, both named per builder.
 *
 * The progressive-apply warm-up compiles throwaway materials over the same
 * output nodes before the live material, so the live builder inherited code
 * naming the warm builder's uniforms and never registered its own. Prod,
 * 2026-09-17: "struct member nodeUniform1 not found", "unresolved value
 * 'nodeUniform0'", and a composite pipeline that failed on every preset
 * switch after the first. This builds the sampler with two WGSL builders,
 * the way the warm-up does, and requires the second shader to declare every
 * binding its function body reads.
 */
import { describe, expect, test } from 'bun:test';
import { installDomEnvironment } from '../environment/dom.ts';

installDomEnvironment();

const {
  Data3DTexture,
  DataTexture,
  Mesh,
  NodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  StandardNodeLibrary,
  UnsignedByteType,
  WGSLNodeBuilder,
} = await import('three/webgpu');
const { context, float, texture, texture3D, uv } = await import('three/tsl');
const { createSampleAuxTextureNode } = await import(
  '../../src/js/milkdrop/feedback-manager-webgpu-composite.ts'
);

// One backend for the process, as in a real renderer: the stale-code cache
// three keeps in NodeBuilder.buildFunctionNode is keyed on it.
const BACKEND = {
  utils: {
    getTextureSampleData: () => ({
      primarySamples: 1,
      samples: 1,
      isMSAA: false,
    }),
  },
};

/** Generates a fragment shader for `outputNode` with a fresh NodeBuilder. */
function buildFragment(outputNode: unknown): string {
  const material = new NodeMaterial();
  material.outputNode = outputNode as typeof material.outputNode;
  const mesh = new Mesh(new PlaneGeometry(), material);
  const renderer = {
    backend: BACKEND,
    contextNode: context({}),
    library: new StandardNodeLibrary(),
    nodes: {},
    getMRT: () => null,
    getRenderTarget: () => null,
    hasFeature: () => true,
    toneMapping: 0,
    outputColorSpace: 'srgb',
    currentToneMapping: 0,
    currentColorSpace: 'srgb',
    xr: {},
    shadowMap: {},
    capabilities: {},
    info: {},
  };
  // The typings stop at the public node API; `build()` and the two scene
  // fields are what the renderer's own Nodes.getForRender sets and calls.
  const builder = new WGSLNodeBuilder(mesh, renderer as never) as unknown as {
    camera: unknown;
    scene: unknown;
    build: () => void;
    fragmentShader: string;
  };
  builder.camera = new OrthographicCamera();
  builder.scene = new Scene();
  builder.build();
  return builder.fragmentShader;
}

function flatTexture() {
  return texture(
    new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType),
  );
}

function flatVolume() {
  return texture3D(
    new Data3DTexture(new Uint8Array(4), 1, 1, 1),
    null as never,
    null as never,
  );
}

function createSampler() {
  return createSampleAuxTextureNode(
    ...(Array.from({ length: 16 }, flatTexture) as Parameters<
      typeof createSampleAuxTextureNode
    > extends [...infer Textures, unknown]
      ? Textures
      : never),
    {
      noise: flatVolume(),
      simplex: flatVolume(),
      voronoi: flatVolume(),
      aura: flatVolume(),
      caustics: flatVolume(),
      pattern: flatVolume(),
      fractal: flatVolume(),
      perlin: flatVolume(),
      noisevol: flatVolume(),
    },
  );
}

/** Names a shader declares as texture bindings or object-struct members. */
function declaredBindings(shader: string) {
  const declared = new Set<string>();
  for (const match of shader.matchAll(/var (nodeUniform\d+) : texture/g)) {
    declared.add(match[1]);
  }
  const objectStruct = shader.match(/struct objectStruct \{([\s\S]*?)\};/);
  for (const match of (objectStruct?.[1] ?? '').matchAll(
    /(nodeUniform\d+) :/g,
  )) {
    declared.add(`object.${match[1]}`);
  }
  return declared;
}

/** Every `nodeUniformN` / `object.nodeUniformN` the emitted function reads. */
function bindingsReadByAuxFunction(shader: string) {
  const body = shader.match(/fn milkdropSampleAuxTexture2d[\s\S]*?\n\}\n/)?.[0];
  expect(body).toBeString();
  const reads = new Set<string>();
  for (const match of (body ?? '').matchAll(/(object\.)?(nodeUniform\d+)/g)) {
    reads.add(`${match[1] ?? ''}${match[2]}`);
  }
  return reads;
}

describe('composite aux-texture sampler layout function', () => {
  test('a second builder over the same sampler declares every binding its function reads', () => {
    const sampler = createSampler();
    const sample = () => sampler.dynamic(float(0), float(0), uv(), float(0));

    // The warm-up: a throwaway material builds the nodes first.
    const warm = buildFragment(sample());
    // The live material: the same nodes, a fresh builder whose uniform
    // table starts at a different index because it registers more before
    // reaching the function (here: one extra uniform ahead of the sample).
    const live = buildFragment(sample().add(float(0.25).toVar()));

    for (const shader of [warm, live]) {
      const declared = declaredBindings(shader);
      for (const read of bindingsReadByAuxFunction(shader)) {
        expect(declared).toContain(read);
      }
    }
  });

  test('the function is still emitted once rather than inlined per call', () => {
    const sampler = createSampler();
    const twice = sampler
      .dynamic(float(0), float(0), uv(), float(0))
      .add(sampler.dynamic(float(1), float(0), uv(), float(0)));
    const shader = buildFragment(twice);
    expect(shader.match(/fn milkdropSampleAuxTexture2d/g)).toHaveLength(1);
    expect(
      shader.match(/milkdropSampleAuxTexture2d\(/g)?.length,
    ).toBeGreaterThan(1);
  });
});
