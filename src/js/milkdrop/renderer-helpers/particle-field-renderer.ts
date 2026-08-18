import type { Group, Mesh } from 'three';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
  ShaderMaterial,
  Mesh as ThreeMesh,
} from 'three';
// @ts-expect-error - 'three/webgpu' is available at runtime but not under the repo's current moduleResolution.
import { NodeMaterial, TSL } from 'three/webgpu';
import {
  disposeObject,
  getMilkdropPassRenderOrder,
  markAlwaysOnscreen,
  type trimGroupChildren,
  withRenderOrder,
} from '../renderer-adapter-shared';
import type {
  MilkdropParticleFieldVisual,
  MilkdropRenderPayload,
  MilkdropRuntimeSignals,
} from '../types';

type ParticleFieldObject = Mesh<InstancedBufferGeometry, ShaderMaterial>;

type ParticleFieldSyncContext = {
  backend: 'webgl' | 'webgpu';
  particleField: MilkdropParticleFieldVisual | null | undefined;
  mesh: MilkdropRenderPayload['frameState']['mesh'];
  meshPositions: ArrayLike<number>;
  signals: MilkdropRenderPayload['frameState']['signals'] | null;
  alphaMultiplier?: number;
};

const PARTICLE_FIELD_BASE_GEOMETRY = new PlaneGeometry(1, 1, 1, 1);

function getSignalValue(
  signals: MilkdropRuntimeSignals | null,
  camelKey: 'time' | 'beatPulse' | 'music' | 'bassAtt' | 'midAtt' | 'trebleAtt',
) {
  if (!signals) {
    return 0;
  }

  switch (camelKey) {
    case 'time':
      return signals.time ?? 0;
    case 'beatPulse':
      return signals.beatPulse ?? signals.beat_pulse ?? 0;
    case 'music':
      return signals.music ?? 0;
    case 'bassAtt':
      return signals.bassAtt ?? signals.bass_att ?? 0;
    case 'midAtt':
      return signals.midAtt ?? signals.mid_att ?? signals.midsAtt ?? 0;
    case 'trebleAtt':
      return signals.trebleAtt ?? signals.treble_att ?? signals.treb_att ?? 0;
  }
}

function createParticleFieldGeometry(instanceCount: number) {
  const geometry = new InstancedBufferGeometry();
  geometry.copy(
    PARTICLE_FIELD_BASE_GEOMETRY as unknown as InstancedBufferGeometry,
  );
  geometry.instanceCount = instanceCount;
  geometry.userData.skipDynamicBounds = true;
  return geometry;
}

function makeParticleFieldUniforms(
  particleField: MilkdropParticleFieldVisual,
  mesh: MilkdropRenderPayload['frameState']['mesh'],
  signals: MilkdropRenderPayload['frameState']['signals'] | null,
  alphaMultiplier: number,
) {
  const opacity = particleField.alpha * alphaMultiplier;
  return {
    baseColor: {
      value: new Color(mesh.color.r, mesh.color.g, mesh.color.b),
    },
    time: { value: getSignalValue(signals, 'time') },
    beatPulse: { value: getSignalValue(signals, 'beatPulse') },
    music: { value: getSignalValue(signals, 'music') },
    bassAtt: { value: getSignalValue(signals, 'bassAtt') },
    midAtt: { value: getSignalValue(signals, 'midAtt') },
    trebleAtt: { value: getSignalValue(signals, 'trebleAtt') },
    motionScale: { value: particleField.motionScale },
    size: { value: particleField.size },
    opacity: { value: opacity },
    seed: { value: particleField.seed },
  };
}

// The WebGPU path needs a NodeMaterial (WebGPURenderer's NodeBuilder does
// not recognize plain ShaderMaterial and silently swaps in a blank default
// material), while the WebGL path keeps the original GLSL ShaderMaterial —
// this helper runs on both backends, unlike the procedural descriptor
// materials in webgpu-procedural-materials.ts.
const {
  attribute,
  cameraProjectionMatrix,
  modelViewMatrix,
  positionGeometry,
  smoothstep,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} = TSL;

function createParticleFieldNodeMaterial(
  particleField: MilkdropParticleFieldVisual,
  mesh: MilkdropRenderPayload['frameState']['mesh'],
  signals: MilkdropRenderPayload['frameState']['signals'] | null,
  alphaMultiplier: number,
) {
  const state = makeParticleFieldUniforms(
    particleField,
    mesh,
    signals,
    alphaMultiplier,
  );
  const uniforms = Object.fromEntries(
    Object.entries(state).map(([key, entry]) => [key, uniform(entry.value)]),
  );

  const instanceAnchor = attribute('instanceAnchor', 'vec3');
  const instanceSeed = attribute('instanceSeed', 'float');
  const instanceId = attribute('instanceId', 'float');

  const phase = instanceSeed
    .mul(6.2831853)
    .add(instanceId.mul(0.071))
    .add(uniforms.time.mul(uniforms.motionScale.mul(24.0).add(1.25)));
  const orbit = phase
    .mul(1.13)
    .add(uniforms.seed.mul(0.01))
    .sin()
    .mul(uniforms.motionScale)
    .mul(0.85);
  const flutter = phase
    .mul(1.67)
    .add(uniforms.seed.mul(0.02))
    .cos()
    .mul(uniforms.motionScale)
    .mul(0.6);
  const audioLift = uniforms.beatPulse
    .mul(0.5)
    .add(uniforms.music.mul(0.2))
    .add(uniforms.bassAtt.mul(0.1))
    .sub(uniforms.trebleAtt.mul(0.06))
    .mul(uniforms.motionScale)
    .mul(1.8);
  const audioShift = uniforms.midAtt
    .sub(uniforms.trebleAtt)
    .mul(uniforms.motionScale)
    .mul(1.4);
  const animatedAnchor = instanceAnchor.add(
    vec3(orbit.add(audioShift), flutter.add(audioLift), 0.0),
  );
  const scale = uniforms.size.mul(instanceSeed.mul(0.7).add(0.65));
  const localPosition = vec3(positionGeometry.xy.mul(scale), 0.0);

  const vColor = varying(
    uniforms.baseColor.mul(
      phase.mul(0.5).add(instanceId).sin().mul(0.35).add(0.75),
    ),
  );
  const vAlpha = uniforms.opacity.mul(
    uniforms.beatPulse.mul(0.55).add(uniforms.music.mul(0.12)).add(0.7),
  );

  const centered = uv().mul(2.0).sub(1.0);
  const radius = centered.length();
  // smoothstep with descending edges is a WGSL const-eval error, so the
  // original glsl smoothstep(1.0, 0.2, r) is expressed via the identity
  // smoothstep(hi, lo, x) === 1 - smoothstep(lo, hi, x).
  const glow = smoothstep(0.2, 1.0, radius).oneMinus();
  const core = smoothstep(0.0, 0.75, radius).oneMinus();

  const material = new NodeMaterial();
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = DoubleSide;
  material.blending = AdditiveBlending;
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(animatedAnchor.add(localPosition), 1.0));
  material.colorNode = vec4(
    vColor.add(vec3(core.mul(0.25))),
    vAlpha.mul(glow).mul(glow),
  );
  material.userData.particleFieldSeed = particleField.seed;
  return Object.assign(material, { uniforms }) as unknown as ShaderMaterial;
}

function createParticleFieldShaderMaterial(
  particleField: MilkdropParticleFieldVisual,
  mesh: MilkdropRenderPayload['frameState']['mesh'],
  signals: MilkdropRenderPayload['frameState']['signals'] | null,
  alphaMultiplier: number,
) {
  const material = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
    // two-pass render (it bumps material.needsUpdate twice per object per
    // frame, forcing getParameters/getProgram churn on every material).
    forceSinglePass: true,
    blending: AdditiveBlending,
    uniforms: makeParticleFieldUniforms(
      particleField,
      mesh,
      signals,
      alphaMultiplier,
    ),
    vertexShader: `
      attribute vec3 instanceAnchor;
      attribute float instanceSeed;
      attribute float instanceId;

      uniform vec3 baseColor;
      uniform float time;
      uniform float beatPulse;
      uniform float music;
      uniform float bassAtt;
      uniform float midAtt;
      uniform float trebleAtt;
      uniform float motionScale;
      uniform float size;
      uniform float opacity;
      uniform float seed;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vUv = uv;

        float phase =
          instanceSeed * 6.2831853 +
          instanceId * 0.071 +
          time * (1.25 + motionScale * 24.0);
        float orbit = sin(phase * 1.13 + seed * 0.01) * motionScale * 0.85;
        float flutter = cos(phase * 1.67 + seed * 0.02) * motionScale * 0.6;
        float audioLift =
          (beatPulse * 0.5 + music * 0.2 + bassAtt * 0.1 - trebleAtt * 0.06) *
          motionScale * 1.8;
        float audioShift = (midAtt - trebleAtt) * motionScale * 1.4;
        vec3 animatedAnchor =
          instanceAnchor +
          vec3(
            orbit + audioShift,
            flutter + audioLift,
            0.0
          );

        float scale = size * (0.65 + instanceSeed * 0.7);
        vec3 localPosition = vec3(position.xy * scale, 0.0);
        vec4 mvPosition = modelViewMatrix * vec4(animatedAnchor + localPosition, 1.0);

        vColor = baseColor * (0.75 + 0.35 * sin(phase * 0.5 + instanceId));
        vAlpha = opacity * (0.7 + beatPulse * 0.55 + music * 0.12);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 centered = vUv * 2.0 - 1.0;
        float radius = length(centered);
        float glow = smoothstep(1.0, 0.2, radius);
        float core = smoothstep(0.75, 0.0, radius);
        float alpha = vAlpha * glow * glow;
        vec3 color = vColor + vec3(core * 0.25);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  material.userData.particleFieldSeed = particleField.seed;
  return material;
}

function createParticleFieldMaterial(
  backend: 'webgl' | 'webgpu',
  particleField: MilkdropParticleFieldVisual,
  mesh: MilkdropRenderPayload['frameState']['mesh'],
  signals: MilkdropRenderPayload['frameState']['signals'] | null,
  alphaMultiplier: number,
) {
  return backend === 'webgpu'
    ? createParticleFieldNodeMaterial(
        particleField,
        mesh,
        signals,
        alphaMultiplier,
      )
    : createParticleFieldShaderMaterial(
        particleField,
        mesh,
        signals,
        alphaMultiplier,
      );
}

function isParticleFieldMaterialForBackend(
  material: unknown,
  backend: 'webgl' | 'webgpu',
) {
  return backend === 'webgpu'
    ? material instanceof NodeMaterial
    : material instanceof ShaderMaterial;
}

function getParticleFieldInstanceAnchors(
  particleField: MilkdropParticleFieldVisual,
  meshPositions: ArrayLike<number>,
) {
  if (meshPositions.length < 3) {
    return {
      anchors: new Float32Array(0),
      seeds: new Float32Array(0),
      ids: new Float32Array(0),
    };
  }

  const instanceCount = particleField.instanceCount;
  const pointCount = Math.floor(meshPositions.length / 3);
  const anchors = new Float32Array(instanceCount * 3);
  const seeds = new Float32Array(instanceCount);
  const ids = new Float32Array(instanceCount);

  for (let index = 0; index < instanceCount; index += 1) {
    const pointIndex = Math.floor((index * pointCount) / instanceCount);
    const baseIndex = (pointIndex % pointCount) * 3;
    const x = meshPositions[baseIndex] ?? 0;
    const y = meshPositions[baseIndex + 1] ?? 0;
    const z = meshPositions[baseIndex + 2] ?? 0;
    const seed = fract(hashNumericValues(particleField.seed, index, x, y, z));
    const jitterX = (fract(seed * 13.371) - 0.5) * 0.03;
    const jitterY = (fract(seed * 91.731) - 0.5) * 0.03;
    const jitterZ = (fract(seed * 47.519) - 0.5) * 0.02;

    anchors[index * 3] = x + jitterX;
    anchors[index * 3 + 1] = y + jitterY;
    anchors[index * 3 + 2] = z + 0.18 + jitterZ;
    seeds[index] = seed;
    ids[index] = index;
  }

  return {
    anchors,
    seeds,
    ids,
  };
}

function hashNumericValues(
  seed: number,
  index: number,
  x: number,
  y: number,
  z: number,
) {
  let hash = 2166136261;
  const s = (seed * 1000) | 0;
  hash = Math.imul(hash ^ (s & 0xff), 16777619);
  hash = Math.imul(hash ^ ((s >> 8) & 0xff), 16777619);
  hash = Math.imul(hash ^ (index & 0xff), 16777619);
  hash = Math.imul(hash ^ ((index >> 8) & 0xff), 16777619);
  const xi = (x * 1000) | 0;
  hash = Math.imul(hash ^ (xi & 0xff), 16777619);
  hash = Math.imul(hash ^ ((xi >> 8) & 0xff), 16777619);
  const yi = (y * 1000) | 0;
  hash = Math.imul(hash ^ (yi & 0xff), 16777619);
  hash = Math.imul(hash ^ ((yi >> 8) & 0xff), 16777619);
  const zi = (z * 1000) | 0;
  hash = Math.imul(hash ^ (zi & 0xff), 16777619);
  hash = Math.imul(hash ^ ((zi >> 8) & 0xff), 16777619);
  return (hash >>> 0) / 0x100000000;
}

function fract(value: number) {
  return value - Math.floor(value);
}

function updateParticleFieldAttributes(
  geometry: InstancedBufferGeometry,
  particleField: MilkdropParticleFieldVisual,
  meshPositions: ArrayLike<number>,
) {
  const { anchors, seeds, ids } = getParticleFieldInstanceAnchors(
    particleField,
    meshPositions,
  );

  // Per-instance data must be InstancedBufferAttribute so both backends set
  // an instance step mode for it; a plain attribute would be consumed
  // per-vertex (only the plane's four vertices ever read) and every
  // instance would render identically.
  const setInstancedAttribute = (
    name: string,
    values: Float32Array,
    itemSize: number,
  ) => {
    const existing = geometry.getAttribute(
      name,
    ) as InstancedBufferAttribute | null;
    if (
      existing instanceof InstancedBufferAttribute &&
      existing.array.length === values.length
    ) {
      (existing.array as Float32Array).set(values);
      existing.needsUpdate = true;
      return;
    }
    const attribute = new InstancedBufferAttribute(values, itemSize);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  };

  setInstancedAttribute('instanceAnchor', anchors, 3);
  setInstancedAttribute('instanceSeed', seeds, 1);
  setInstancedAttribute('instanceId', ids, 1);

  geometry.instanceCount = particleField.instanceCount;
}

export function createParticleFieldObject({
  backend,
  particleField,
  mesh,
  meshPositions,
  signals,
  alphaMultiplier = 1,
}: ParticleFieldSyncContext) {
  if (
    !particleField?.enabled ||
    particleField.instanceCount <= 0 ||
    meshPositions.length < 3
  ) {
    return null;
  }

  const geometry = createParticleFieldGeometry(particleField.instanceCount);
  updateParticleFieldAttributes(geometry, particleField, meshPositions);
  const object = withRenderOrder(
    markAlwaysOnscreen(
      new ThreeMesh(
        geometry,
        createParticleFieldMaterial(
          backend,
          particleField,
          mesh,
          signals,
          alphaMultiplier,
        ),
      ),
    ),
    getMilkdropPassRenderOrder('particle-field'),
  );
  object.position.z = 0.18;
  object.userData.particleFieldSeed = particleField.seed;
  return object;
}

export function syncParticleFieldObject(
  existing: ParticleFieldObject | undefined,
  {
    backend,
    particleField,
    mesh,
    meshPositions,
    signals,
    alphaMultiplier = 1,
  }: ParticleFieldSyncContext,
) {
  if (
    !particleField?.enabled ||
    particleField.instanceCount <= 0 ||
    meshPositions.length < 3
  ) {
    if (existing) {
      disposeObject(existing);
    }
    return null;
  }

  // Instance count is deliberately NOT part of the match: it folds in the
  // adaptive-quality detail scale, so a count change happens exactly when
  // the device is under load — rebuilding here would dispose the material
  // and force a pipeline recompile at the worst moment. The attribute
  // updater below resizes buffers and instanceCount in place.
  const matches =
    !!existing &&
    existing.geometry instanceof InstancedBufferGeometry &&
    isParticleFieldMaterialForBackend(existing.material, backend) &&
    existing.userData.particleFieldSeed === particleField.seed;

  if (!matches) {
    if (existing) {
      disposeObject(existing);
    }
    return createParticleFieldObject({
      backend,
      particleField,
      mesh,
      meshPositions,
      signals,
      alphaMultiplier,
    });
  }

  updateParticleFieldAttributes(
    existing.geometry as InstancedBufferGeometry,
    particleField,
    meshPositions,
  );

  const material = existing.material as ShaderMaterial;
  const uniforms = material.uniforms as {
    baseColor: { value: Color };
    time: { value: number };
    beatPulse: { value: number };
    music: { value: number };
    bassAtt: { value: number };
    midAtt: { value: number };
    trebleAtt: { value: number };
    motionScale: { value: number };
    size: { value: number };
    opacity: { value: number };
    seed: { value: number };
  };
  uniforms.baseColor.value.setRGB(mesh.color.r, mesh.color.g, mesh.color.b);
  uniforms.time.value = getSignalValue(signals, 'time');
  uniforms.beatPulse.value = getSignalValue(signals, 'beatPulse');
  uniforms.music.value = getSignalValue(signals, 'music');
  uniforms.bassAtt.value = getSignalValue(signals, 'bassAtt');
  uniforms.midAtt.value = getSignalValue(signals, 'midAtt');
  uniforms.trebleAtt.value = getSignalValue(signals, 'trebleAtt');
  uniforms.motionScale.value = particleField.motionScale;
  uniforms.size.value = particleField.size;
  uniforms.opacity.value = particleField.alpha * alphaMultiplier;
  uniforms.seed.value = particleField.seed;
  // transparent / depthTest / depthWrite / blending / side are set once at
  // material construction and never vary, so they are not re-assigned here —
  // and `needsUpdate` is deliberately NOT set. This function only writes
  // uniform VALUES, which three.js uploads every render on its own; marking
  // the material dirty instead bumped material.version each frame, forcing
  // WebGLRenderer to re-run getParameters() and the program-cache lookup for
  // a program that never changed (~2% of frame time).
  existing.renderOrder = getMilkdropPassRenderOrder('particle-field');
  existing.position.z = 0.18;
  return existing;
}

export function renderParticleFieldGroup({
  backend,
  target,
  group,
  particleField,
  mesh,
  meshPositions,
  signals,
  alphaMultiplier = 1,
  trimGroupChildren: trimChildren,
}: {
  backend: 'webgl' | 'webgpu';
  target: 'particle-field' | 'blend-particle-field';
  group: Group;
  particleField: MilkdropParticleFieldVisual | null | undefined;
  mesh: MilkdropRenderPayload['frameState']['mesh'];
  meshPositions: ArrayLike<number>;
  signals: MilkdropRenderPayload['frameState']['signals'] | null;
  alphaMultiplier?: number;
  trimGroupChildren: typeof trimGroupChildren;
}) {
  const existing = group.children[0] as ParticleFieldObject | undefined;
  const synced = syncParticleFieldObject(existing, {
    backend,
    particleField,
    mesh,
    meshPositions,
    signals,
    alphaMultiplier,
  });

  if (!synced) {
    if (existing) {
      group.remove(existing);
    }
    trimChildren(group, 0);
    return;
  }

  synced.renderOrder = getMilkdropPassRenderOrder(target);
  if (!existing) {
    group.add(synced);
  } else if (synced !== existing) {
    group.remove(existing);
    group.add(synced);
  }
  trimChildren(group, 1);
}
