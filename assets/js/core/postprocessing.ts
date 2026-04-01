import type { Camera, Scene, WebGLRenderer } from 'three';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RendererBackend } from './renderer-capabilities';

export type MilkdropPostprocessingProfile = {
  enabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  filmNoise: number;
  filmScanlines: number;
  filmScanlineCount: number;
  vignetteStrength: number;
  chromaOffset: number;
};

export type PostprocessingPipeline = {
  composer: EffectComposer;
  bloomPass?: UnrealBloomPass;
  filmPass?: FilmPass;
  chromaPass?: ShaderPass;
  applyProfile: (profile: MilkdropPostprocessingProfile) => void;
  render: () => void;
  updateSize: () => void;
  dispose: () => void;
};

type FilmPassUniforms = {
  nIntensity: { value: number };
  sIntensity: { value: number };
  sCount: { value: number };
};

type FilmPassWithUniforms = FilmPass & {
  uniforms: FilmPassUniforms;
};

const MILKDROP_POSTPROCESSING_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new Vector2(1, 1) },
    vignetteStrength: { value: 0 },
    chromaOffset: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float vignetteStrength;
    uniform float chromaOffset;
    varying vec2 vUv;

    void main() {
      vec2 centeredUv = vUv - vec2(0.5);
      vec2 chromaUvOffset = vec2(chromaOffset) / max(resolution, vec2(1.0));

      vec4 baseColor = texture2D(tDiffuse, vUv);
      vec4 chromaColor = vec4(
        texture2D(tDiffuse, vUv + chromaUvOffset).r,
        baseColor.g,
        texture2D(tDiffuse, vUv - chromaUvOffset).b,
        baseColor.a
      );

      float vignetteRadius = clamp(1.0 - vignetteStrength * 0.65, 0.15, 1.0);
      float vignette = smoothstep(
        vignetteRadius,
        vignetteRadius - 0.28,
        length(centeredUv)
      );

      vec3 color = mix(chromaColor.rgb, chromaColor.rgb * vignette, vignetteStrength);
      gl_FragColor = vec4(color, chromaColor.a);
    }
  `,
};

export function isWebGLRenderer(renderer: unknown): renderer is WebGLRenderer {
  return (
    !!renderer &&
    typeof renderer === 'object' &&
    'capabilities' in renderer &&
    'extensions' in renderer
  );
}

export function supportsWebGLPostprocessing(
  backend: RendererBackend | null | undefined,
): boolean {
  return backend === 'webgl';
}

export function resolveWebGLRenderer(
  backend: RendererBackend | null | undefined,
  renderer: unknown,
): WebGLRenderer | null {
  if (!supportsWebGLPostprocessing(backend)) {
    return null;
  }
  return isWebGLRenderer(renderer) ? renderer : null;
}

export function shouldEnableMilkdropPostprocessingProfile(
  profile: MilkdropPostprocessingProfile | null | undefined,
) {
  return Boolean(profile?.enabled);
}

export function shouldRenderMilkdropPostprocessing({
  backend,
  renderer,
  profile,
}: {
  backend: RendererBackend | null | undefined;
  renderer: unknown;
  profile: MilkdropPostprocessingProfile | null | undefined;
}) {
  return (
    supportsWebGLPostprocessing(backend) &&
    shouldEnableMilkdropPostprocessingProfile(profile) &&
    isWebGLRenderer(renderer)
  );
}

export function createMilkdropPostprocessingComposer({
  renderer,
  scene,
  camera,
  profile,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  profile: MilkdropPostprocessingProfile;
}): PostprocessingPipeline | null {
  if (!shouldEnableMilkdropPostprocessingProfile(profile)) {
    return null;
  }

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const size = renderer.getSize(new Vector2());
  const bloomPass = new UnrealBloomPass(
    new Vector2(size.x, size.y),
    profile.bloomStrength,
    profile.bloomRadius,
    profile.bloomThreshold,
  );
  composer.addPass(bloomPass);

  const filmPass = new FilmPass() as FilmPassWithUniforms;
  composer.addPass(filmPass);

  const chromaPass = new ShaderPass(MILKDROP_POSTPROCESSING_SHADER);
  chromaPass.material.uniforms.vignetteStrength.value =
    profile.vignetteStrength;
  chromaPass.material.uniforms.chromaOffset.value = profile.chromaOffset;
  chromaPass.renderToScreen = true;
  composer.addPass(chromaPass);

  const lastSize = size.clone();
  const sizeScratch = new Vector2();
  chromaPass.material.uniforms.resolution.value.set(size.x, size.y);

  const applyProfile = (nextProfile: MilkdropPostprocessingProfile) => {
    bloomPass.strength = nextProfile.bloomStrength;
    bloomPass.radius = nextProfile.bloomRadius;
    bloomPass.threshold = nextProfile.bloomThreshold;
    filmPass.uniforms.nIntensity.value = nextProfile.filmNoise;
    filmPass.uniforms.sIntensity.value = nextProfile.filmScanlines;
    filmPass.uniforms.sCount.value = nextProfile.filmScanlineCount;
    chromaPass.material.uniforms.vignetteStrength.value =
      nextProfile.vignetteStrength;
    chromaPass.material.uniforms.chromaOffset.value = nextProfile.chromaOffset;
  };
  applyProfile(profile);

  const updateSize = () => {
    renderer.getSize(sizeScratch);
    if (sizeScratch.x !== lastSize.x || sizeScratch.y !== lastSize.y) {
      composer.setSize(sizeScratch.x, sizeScratch.y);
      chromaPass.material.uniforms.resolution.value.set(
        sizeScratch.x,
        sizeScratch.y,
      );
      lastSize.copy(sizeScratch);
    }
  };

  return {
    composer,
    bloomPass,
    filmPass,
    chromaPass,
    applyProfile,
    render: () => composer.render(),
    updateSize,
    dispose: () => composer.dispose(),
  };
}

export function createBloomComposer({
  renderer,
  scene,
  camera,
  bloomStrength,
  bloomRadius = 0.4,
  bloomThreshold = 0.85,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  bloomStrength: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}): PostprocessingPipeline {
  const profile: MilkdropPostprocessingProfile = {
    enabled: true,
    bloomStrength,
    bloomRadius,
    bloomThreshold,
    filmNoise: 0,
    filmScanlines: 0,
    filmScanlineCount: 0,
    vignetteStrength: 0,
    chromaOffset: 0,
  };
  const pipeline = createMilkdropPostprocessingComposer({
    renderer,
    scene,
    camera,
    profile,
  });

  if (!pipeline) {
    throw new Error('Bloom composer profile should always be enabled.');
  }

  return pipeline;
}
