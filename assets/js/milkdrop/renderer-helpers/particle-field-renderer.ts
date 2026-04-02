import type { Group, Mesh } from 'three';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
  ShaderMaterial,
  Mesh as ThreeMesh,
} from 'three';
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
  particleField: MilkdropParticleFieldVisual | null | undefined;
  mesh: MilkdropRenderPayload['frameState']['mesh'];
  meshPositions: number[];
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

function createParticleFieldMaterial(
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

function getParticleFieldInstanceAnchors(
  particleField: MilkdropParticleFieldVisual,
  meshPositions: number[],
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
    const seed = fract(
      hashNumber(`${particleField.seed}:${index}:${x}:${y}:${z}`),
    );
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

function hashNumber(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function fract(value: number) {
  return value - Math.floor(value);
}

function updateParticleFieldAttributes(
  geometry: InstancedBufferGeometry,
  particleField: MilkdropParticleFieldVisual,
  meshPositions: number[],
) {
  const { anchors, seeds, ids } = getParticleFieldInstanceAnchors(
    particleField,
    meshPositions,
  );

  const anchorAttribute = geometry.getAttribute(
    'instanceAnchor',
  ) as Float32BufferAttribute | null;
  if (anchorAttribute && anchorAttribute.array.length === anchors.length) {
    anchorAttribute.array.set(anchors);
    anchorAttribute.needsUpdate = true;
  } else {
    const attribute = new Float32BufferAttribute(anchors, 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceAnchor', attribute);
  }

  const seedAttribute = geometry.getAttribute(
    'instanceSeed',
  ) as Float32BufferAttribute | null;
  if (seedAttribute && seedAttribute.array.length === seeds.length) {
    seedAttribute.array.set(seeds);
    seedAttribute.needsUpdate = true;
  } else {
    const attribute = new Float32BufferAttribute(seeds, 1);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceSeed', attribute);
  }

  const idAttribute = geometry.getAttribute(
    'instanceId',
  ) as Float32BufferAttribute | null;
  if (idAttribute && idAttribute.array.length === ids.length) {
    idAttribute.array.set(ids);
    idAttribute.needsUpdate = true;
  } else {
    const attribute = new Float32BufferAttribute(ids, 1);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceId', attribute);
  }

  geometry.instanceCount = particleField.instanceCount;
}

export function createParticleFieldObject({
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

  const matches =
    !!existing &&
    existing.geometry instanceof InstancedBufferGeometry &&
    existing.geometry.instanceCount === particleField.instanceCount &&
    existing.material instanceof ShaderMaterial &&
    existing.userData.particleFieldSeed === particleField.seed;

  if (!matches) {
    if (existing) {
      disposeObject(existing);
    }
    return createParticleFieldObject({
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
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;
  material.needsUpdate = true;
  existing.renderOrder = getMilkdropPassRenderOrder('particle-field');
  existing.position.z = 0.18;
  return existing;
}

export function renderParticleFieldGroup({
  target,
  group,
  particleField,
  mesh,
  meshPositions,
  signals,
  alphaMultiplier = 1,
  trimGroupChildren: trimChildren,
}: {
  target: 'particle-field' | 'blend-particle-field';
  group: Group;
  particleField: MilkdropParticleFieldVisual | null | undefined;
  mesh: MilkdropRenderPayload['frameState']['mesh'];
  meshPositions: number[];
  signals: MilkdropRenderPayload['frameState']['signals'] | null;
  alphaMultiplier?: number;
  trimGroupChildren: typeof trimGroupChildren;
}) {
  const existing = group.children[0] as ParticleFieldObject | undefined;
  const synced = syncParticleFieldObject(existing, {
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
