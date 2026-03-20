import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface ToyLike {
  capabilities?: {
    demoAudio?: boolean;
    microphone?: boolean;
    motion?: boolean;
  };
  description?: string;
  moods?: string[];
  slug?: string;
  tags?: string[];
  title?: string;
}

type GeometryFactory = () => BufferGeometry;

type PreviewStyle = {
  baseColor: number;
  emissiveMultiplier: number;
  geometry: GeometryFactory;
  metalness: number;
  motionX: number;
  motionY: number;
  overlayOpacity: number;
  roughness: number;
  surfaceTexture: (typeof PREVIEW_SURFACE_TEXTURES)[number];
  detailTexture: (typeof PREVIEW_DETAIL_TEXTURES)[number];
};

interface PreviewItem {
  composer: EffectComposer | null;
  camera: PerspectiveCamera;
  dispose: () => void;
  group: Group;
  hoverStrength: number;
  isActive: boolean;
  isVisible: boolean;
  mesh: Mesh;
  overlay: Mesh;
  renderer: WebGLRenderer;
  root: HTMLElement;
  scene: Scene;
  style: PreviewStyle;
}

type AmbientShardState = {
  drift: number;
  offset: number;
  position: Vector3;
  rotation: Vector3;
  scale: number;
};

const BACKGROUND_FRAME_INTERVAL_MS = 1000 / 16;
const PREVIEW_FRAME_INTERVAL_MS = 1000 / 12;
const PREVIEW_SURFACE_TEXTURES = [
  'circuit_board_pattern.png',
  'water_caustics.png',
  'crystal_fractal.png',
] as const;
const PREVIEW_DETAIL_TEXTURES = [
  'seamless_perlin_noise.png',
  'simplex_noise_3d.png',
  'voronoi_cellular.png',
] as const;
const AMBIENT_AURA_TEXTURE = 'colorful_aura_gradient.png';
const AMBIENT_PARTICLE_TEXTURE = 'radial_rainbow_gradient.png';

type TextureConfig = {
  anisotropy?: number;
  colorSpace?: typeof SRGBColorSpace;
  generateMipmaps?: boolean;
  magFilter?: Texture['magFilter'];
  minFilter?: Texture['minFilter'];
  repeatX?: number;
  repeatY?: number;
  wrapping?: Texture['wrapS'];
};

const PREVIEW_STYLE_TRAITS: Array<{
  terms: string[];
  style: PreviewStyle;
}> = [
  {
    terms: [
      'halo',
      'holy',
      'bubble',
      'bubbles',
      'ethereal',
      'serene',
      'ambient',
    ],
    style: {
      baseColor: 0xf4d77c,
      emissiveMultiplier: 0.4,
      geometry: () => new TorusKnotGeometry(0.56, 0.16, 100, 18),
      metalness: 0.35,
      motionX: 0.005,
      motionY: 0.011,
      overlayOpacity: 0.2,
      roughness: 0.5,
      surfaceTexture: 'water_caustics.png',
      detailTexture: 'voronoi_cellular.png',
    },
  },
  {
    terms: [
      'geom',
      'geometry',
      '3d',
      'multi',
      'lights',
      'luminous',
      'shader',
      'tunnel',
    ],
    style: {
      baseColor: 0x5dc7ff,
      emissiveMultiplier: 0.34,
      geometry: () => new BoxGeometry(1.1, 1.1, 1.1, 8, 8, 8),
      metalness: 0.76,
      motionX: 0.008,
      motionY: 0.009,
      overlayOpacity: 0.16,
      roughness: 0.28,
      surfaceTexture: 'circuit_board_pattern.png',
      detailTexture: 'simplex_noise_3d.png',
    },
  },
  {
    terms: [
      'clay',
      'seary',
      'symph',
      'synesthetic',
      'patterns',
      'pottery',
      'spectrograph',
      'focus',
    ],
    style: {
      baseColor: 0xff8d5b,
      emissiveMultiplier: 0.24,
      geometry: () => new SphereGeometry(0.74, 32, 32),
      metalness: 0.2,
      motionX: 0.004,
      motionY: 0.006,
      overlayOpacity: 0.14,
      roughness: 0.72,
      surfaceTexture: 'crystal_fractal.png',
      detailTexture: 'seamless_perlin_noise.png',
    },
  },
  {
    terms: [
      'evol',
      'legible',
      'terminal',
      'retro',
      'grid',
      'glitch',
      'psychedelic',
      'cosmic',
    ],
    style: {
      baseColor: 0x84ff90,
      emissiveMultiplier: 0.28,
      geometry: () => new IcosahedronGeometry(0.78, 1),
      metalness: 0.58,
      motionX: 0.007,
      motionY: 0.013,
      overlayOpacity: 0.12,
      roughness: 0.34,
      surfaceTexture: 'circuit_board_pattern.png',
      detailTexture: 'voronoi_cellular.png',
    },
  },
];

const FALLBACK_PREVIEW_STYLE: PreviewStyle = {
  baseColor: 0xd36fff,
  emissiveMultiplier: 0.28,
  geometry: () => new TorusKnotGeometry(0.56, 0.18, 92, 12),
  metalness: 0.62,
  motionX: 0.005,
  motionY: 0.008,
  overlayOpacity: 0.15,
  roughness: 0.38,
  surfaceTexture: 'water_caustics.png',
  detailTexture: 'simplex_noise_3d.png',
};

export function createLibraryThreeEffects() {
  let backgroundRenderer: WebGLRenderer | null = null;
  let backgroundScene: Scene | null = null;
  let backgroundCamera: PerspectiveCamera | null = null;
  let backgroundParticles: Points | null = null;
  let backgroundShards: InstancedMesh | null = null;
  let backgroundShardStates: AmbientShardState[] = [];
  let ambientBackdrop: Mesh | null = null;
  let backgroundComposer: EffectComposer | null = null;
  let animationFrame = 0;
  let pulse = 0;
  let resizeHandler: (() => void) | null = null;
  let pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  let pointerLeaveHandler: (() => void) | null = null;
  let previewObserver: IntersectionObserver | null = null;
  let visibilityHandler: (() => void) | null = null;
  const backgroundColor = new Color(0x0b0d16);
  const previews = new Map<string, PreviewItem>();
  const textureLoader = new TextureLoader();
  const loadedTextures = new Map<string, Texture>();
  const pointerState = {
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
  };
  const launchState = {
    active: false,
    cardX: 0,
    cardY: 0,
    expiresAt: 0,
    strength: 0,
    targetStrength: 0,
  };
  let lastBackgroundRenderAt = 0;
  let lastPreviewRenderAt = 0;

  const getTextureAnisotropy = (renderer?: WebGLRenderer | null) => {
    if (!renderer) return 1;
    return Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  };

  const resolveTextureUrl = (fileName: string) => {
    const baseUrl =
      typeof import.meta.env.BASE_URL === 'string'
        ? import.meta.env.BASE_URL
        : '/';
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${normalizedBaseUrl}textures/${fileName}`;
  };

  const getTexture = (fileName: string, config: TextureConfig = {}) => {
    const {
      anisotropy = 1,
      colorSpace,
      generateMipmaps = true,
      magFilter = LinearFilter,
      minFilter = generateMipmaps ? LinearMipmapLinearFilter : LinearFilter,
      repeatX = 1,
      repeatY = repeatX,
      wrapping = RepeatWrapping,
    } = config;
    const cacheKey = JSON.stringify({
      anisotropy,
      colorSpace: colorSpace ?? 'default',
      fileName,
      generateMipmaps,
      magFilter,
      minFilter,
      repeatX,
      repeatY,
      wrapping,
    });
    const cachedTexture = loadedTextures.get(cacheKey);
    if (cachedTexture) return cachedTexture;

    const texture = textureLoader.load(resolveTextureUrl(fileName));
    texture.wrapS = wrapping;
    texture.wrapT = wrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = anisotropy;
    texture.generateMipmaps = generateMipmaps;
    texture.magFilter = magFilter;
    texture.minFilter = minFilter;
    if (colorSpace) {
      texture.colorSpace = colorSpace;
    }
    loadedTextures.set(cacheKey, texture);
    return texture;
  };

  const canUseWebGL = () => {
    try {
      const canvas = document.createElement('canvas');
      const context =
        canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? null;
      return Boolean(context);
    } catch (_error) {
      return false;
    }
  };

  const createComposer = (
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    size: Vector2,
    bloomStrength: number,
  ) => {
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(1);
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(
        new Vector2(size.x, size.y),
        bloomStrength,
        0.6,
        0.85,
      ),
    );
    return composer;
  };

  const extractToyTerms = (toy: ToyLike) => {
    const parts = [
      toy.slug,
      toy.title,
      toy.description,
      ...(toy.tags ?? []),
      ...(toy.moods ?? []),
      toy.capabilities?.motion ? 'motion' : '',
      toy.capabilities?.microphone ? 'microphone reactive live' : '',
      toy.capabilities?.demoAudio ? 'demo audio preview' : '',
    ];
    return parts
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean);
  };

  const pickPreviewStyle = (toy: ToyLike, index: number) => {
    const terms = new Set(extractToyTerms(toy));
    let bestStyle: PreviewStyle | null = null;
    let bestScore = 0;
    PREVIEW_STYLE_TRAITS.forEach(({ terms: styleTerms, style }) => {
      const score = styleTerms.reduce(
        (total, term) => total + (terms.has(term) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestStyle = style;
      }
    });
    if (bestStyle) return bestStyle;
    return {
      ...FALLBACK_PREVIEW_STYLE,
      baseColor: new Color()
        .setHSL(((index * 0.17) % 1) + 0.04, 0.72, 0.6)
        .getHex(),
      surfaceTexture:
        PREVIEW_SURFACE_TEXTURES[index % PREVIEW_SURFACE_TEXTURES.length],
      detailTexture:
        PREVIEW_DETAIL_TEXTURES[index % PREVIEW_DETAIL_TEXTURES.length],
    };
  };

  const webglAvailable =
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    canUseWebGL();
  const isCompactViewport =
    typeof window !== 'undefined' && window.innerWidth < 960;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previewLimit = prefersReducedMotion ? 0 : 1;

  const shouldRender = () =>
    typeof document === 'undefined' ? true : !document.hidden;

  const createAmbientMaterial = () =>
    new ShaderMaterial({
      uniforms: {
        uAura: {
          value: getTexture(AMBIENT_AURA_TEXTURE, {
            colorSpace: SRGBColorSpace,
            generateMipmaps: false,
            wrapping: MirroredRepeatWrapping,
          }),
        },
        uNoise: {
          value: getTexture('seamless_perlin_noise.png', {
            anisotropy: getTextureAnisotropy(backgroundRenderer),
            repeatX: 1.5,
            repeatY: 1.5,
          }),
        },
        uLaunchCenter: { value: new Vector2(0.5, 0.5) },
        uLaunchStrength: { value: 0 },
        uPointer: { value: new Vector2(0, 0) },
        uPulse: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uAura;
        uniform sampler2D uNoise;
        uniform vec2 uLaunchCenter;
        uniform float uLaunchStrength;
        uniform vec2 uPointer;
        uniform float uPulse;
        uniform float uTime;

        varying vec2 vUv;

        void main() {
          vec2 centered = vUv - 0.5;
          vec2 drift = vec2(
            sin(uTime * 0.3 + centered.y * 3.0),
            cos(uTime * 0.24 + centered.x * 3.8)
          ) * 0.025;
          vec2 pointerOffset = uPointer * 0.08;
          vec2 noiseUv = vUv * 1.4 + drift + pointerOffset;
          vec4 aura = texture2D(uAura, vUv + drift * 0.45 - pointerOffset * 0.35);
          vec4 noise = texture2D(uNoise, noiseUv);
          float ring = smoothstep(0.7, 0.15, length(centered + pointerOffset * 0.25));
          float launchRadius = length(vUv - uLaunchCenter);
          float launchGlow = smoothstep(0.45, 0.0, launchRadius) * uLaunchStrength;
          vec3 color = mix(aura.rgb, aura.bgr, noise.r * 0.4);
          color += vec3(0.25, 0.18, 0.35) * launchGlow;
          float alpha = (0.12 + ring * 0.12 + noise.g * 0.08 + launchGlow * 0.25) * (1.0 + uPulse * 0.45);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

  const createAmbientShards = () => {
    const count = 96;
    const mesh = new InstancedMesh(
      new IcosahedronGeometry(0.12, 0),
      new MeshBasicMaterial({
        color: 0x8fb6ff,
        transparent: true,
        opacity: 0.2,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      count,
    );
    const dummy = new Object3D();
    const states: AmbientShardState[] = [];
    for (let index = 0; index < count; index += 1) {
      const state: AmbientShardState = {
        drift: 0.4 + Math.random() * 0.9,
        offset: Math.random() * Math.PI * 2,
        position: new Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 12,
          -4 - Math.random() * 10,
        ),
        rotation: new Vector3(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ),
        scale: 0.4 + Math.random() * 1.3,
      };
      states.push(state);
      dummy.position.copy(state.position);
      dummy.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
      dummy.scale.setScalar(state.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, states };
  };

  const animate = (now: number) => {
    animationFrame = window.requestAnimationFrame(animate);
    if (!shouldRender()) return;

    pointerState.currentX +=
      (pointerState.targetX - pointerState.currentX) * 0.08;
    pointerState.currentY +=
      (pointerState.targetY - pointerState.currentY) * 0.08;
    if (launchState.active && now >= launchState.expiresAt) {
      launchState.active = false;
      launchState.targetStrength = 0;
    }
    launchState.strength +=
      (launchState.targetStrength - launchState.strength) * 0.16;

    if (
      backgroundRenderer &&
      backgroundScene &&
      backgroundCamera &&
      now - lastBackgroundRenderAt >= BACKGROUND_FRAME_INTERVAL_MS
    ) {
      lastBackgroundRenderAt = now;
      const time = now * 0.0002;
      if (backgroundParticles) {
        backgroundParticles.rotation.y =
          time * (0.18 + pulse * 0.6 + launchState.strength * 0.5) +
          pointerState.currentX * 0.14;
        backgroundParticles.rotation.x =
          Math.sin(time * 2) * 0.07 + pointerState.currentY * 0.1;
      }
      if (backgroundShards) {
        const shards = backgroundShards;
        const dummy = new Object3D();
        backgroundShardStates.forEach((state, index) => {
          dummy.position.set(
            state.position.x +
              Math.sin(time * state.drift + state.offset) * 0.6 +
              pointerState.currentX * 0.8,
            state.position.y +
              Math.cos(time * (state.drift + 0.2) + state.offset) * 0.45 -
              pointerState.currentY * 0.5,
            state.position.z +
              Math.sin(time * 0.7 + state.offset) * 0.35 +
              launchState.strength * 0.9,
          );
          dummy.rotation.set(
            state.rotation.x + time * 0.8 * state.drift,
            state.rotation.y + time * 0.6 * state.drift,
            state.rotation.z +
              time * 0.4 * state.drift +
              launchState.strength * 0.6,
          );
          dummy.scale.setScalar(
            state.scale * (1 + pulse * 0.35 + launchState.strength * 0.4),
          );
          dummy.updateMatrix();
          shards.setMatrixAt(index, dummy.matrix);
        });
        shards.instanceMatrix.needsUpdate = true;
        shards.rotation.y = pointerState.currentX * 0.1;
      }
      if (ambientBackdrop) {
        ambientBackdrop.rotation.z =
          Math.sin(time * 1.7) * 0.08 +
          pointerState.currentX * 0.12 +
          launchState.strength * 0.18;
        ambientBackdrop.position.x =
          Math.sin(time * 1.3) * 0.8 + pointerState.currentX * 1.2;
        ambientBackdrop.position.y =
          Math.cos(time * 1.1) * 0.5 - pointerState.currentY * 0.8;
        const material = ambientBackdrop.material;
        if (material instanceof ShaderMaterial) {
          material.uniforms.uTime.value = time * 14;
          material.uniforms.uPulse.value = pulse;
          material.uniforms.uLaunchCenter.value.set(
            launchState.cardX,
            launchState.cardY,
          );
          material.uniforms.uLaunchStrength.value = launchState.strength;
          material.uniforms.uPointer.value.set(
            pointerState.currentX,
            pointerState.currentY,
          );
        }
      }
      backgroundCamera.position.x =
        pointerState.currentX * 0.75 + (launchState.cardX - 0.5) * 1.4;
      backgroundCamera.position.y =
        -pointerState.currentY * 0.45 + (0.5 - launchState.cardY) * 0.8;
      backgroundCamera.position.z = 14 - launchState.strength * 3.5;
      backgroundCamera.lookAt(0, 0, 0);
      backgroundColor.setHSL(
        0.68 + Math.sin(time) * 0.05,
        0.35,
        0.05 + pulse * 0.02,
      );
      backgroundScene.background = backgroundColor;
      if (backgroundComposer) backgroundComposer.render();
      else backgroundRenderer.render(backgroundScene, backgroundCamera);
    }

    if (now - lastPreviewRenderAt >= PREVIEW_FRAME_INTERVAL_MS) {
      lastPreviewRenderAt = now;
      const visiblePreviews = Array.from(previews.values()).filter(
        (item) => item.isVisible,
      );
      const previewToRender =
        visiblePreviews.find((item) => item.isActive) ??
        visiblePreviews[0] ??
        null;
      if (previewToRender) {
        previewToRender.hoverStrength +=
          (1 - previewToRender.hoverStrength) * 0.16;
        previewToRender.group.rotation.x =
          pointerState.currentY * 0.18 + previewToRender.hoverStrength * 0.04;
        previewToRender.group.rotation.y = pointerState.currentX * 0.22;
        previewToRender.mesh.rotation.x +=
          previewToRender.style.motionX + pulse * 0.008;
        previewToRender.mesh.rotation.y +=
          previewToRender.style.motionY + pulse * 0.01;
        previewToRender.overlay.rotation.z -=
          previewToRender.style.motionY * 0.6;
        previewToRender.overlay.position.x = pointerState.currentX * 0.08;
        previewToRender.overlay.position.y = -pointerState.currentY * 0.06;
        previewToRender.camera.position.x +=
          (pointerState.currentX * 0.18 - previewToRender.camera.position.x) *
          0.12;
        previewToRender.camera.position.y +=
          (-pointerState.currentY * 0.12 - previewToRender.camera.position.y) *
          0.12;
        previewToRender.camera.lookAt(0, 0, 0);
        if (previewToRender.composer) previewToRender.composer.render();
        else
          previewToRender.renderer.render(
            previewToRender.scene,
            previewToRender.camera,
          );
      }
    }

    pulse = Math.max(0, pulse * 0.93 - 0.003);
  };

  const createAmbientLayer = () => {
    if (!webglAvailable || prefersReducedMotion || isCompactViewport) return;
    try {
      const renderer = new WebGLRenderer({ alpha: true, antialias: false });
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.domElement.className = 'library-three-ambient';

      const scene = new Scene();
      const camera = new PerspectiveCamera(
        65,
        window.innerWidth / Math.max(window.innerHeight, 1),
        0.1,
        100,
      );
      camera.position.z = 14;

      const geometry = new SphereGeometry(0.03, 6, 6);
      const material = new PointsMaterial({
        size: 0.1,
        color: 0x88aaff,
        map: getTexture(AMBIENT_PARTICLE_TEXTURE, {
          colorSpace: SRGBColorSpace,
          generateMipmaps: false,
          wrapping: ClampToEdgeWrapping,
        }),
        alphaMap: getTexture(AMBIENT_PARTICLE_TEXTURE, {
          generateMipmaps: false,
          wrapping: ClampToEdgeWrapping,
        }),
        transparent: true,
        opacity: 0.4,
        alphaTest: 0.08,
        depthWrite: false,
      });
      const points = new Points(geometry, material);
      const positions: number[] = [];
      for (let i = 0; i < 1000; i += 1) {
        positions.push(
          (Math.random() - 0.5) * 25,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 20,
        );
      }
      points.geometry.setAttribute(
        'position',
        new Float32BufferAttribute(positions, 3),
      );

      const backdrop = new Mesh(
        new PlaneGeometry(34, 20, 1, 1),
        createAmbientMaterial(),
      );
      backdrop.position.z = -8;
      const { mesh: shards, states } = createAmbientShards();

      scene.add(backdrop);
      scene.add(points);
      scene.add(shards);
      scene.add(new AmbientLight(0x8899ff, 0.45));

      document.body.appendChild(renderer.domElement);
      backgroundRenderer = renderer;
      backgroundScene = scene;
      backgroundCamera = camera;
      backgroundParticles = points;
      backgroundShards = shards;
      backgroundShardStates = states;
      ambientBackdrop = backdrop;
      backgroundComposer = createComposer(
        renderer,
        scene,
        camera,
        new Vector2(window.innerWidth, window.innerHeight),
        0.8,
      );

      resizeHandler = () => {
        if (!backgroundRenderer || !backgroundCamera) return;
        backgroundRenderer.setSize(window.innerWidth, window.innerHeight);
        backgroundComposer?.setSize(window.innerWidth, window.innerHeight);
        backgroundCamera.aspect =
          window.innerWidth / Math.max(window.innerHeight, 1);
        backgroundCamera.updateProjectionMatrix();
      };
      window.addEventListener('resize', resizeHandler);
    } catch (_error) {
      // Gracefully skip when WebGL is unavailable.
    }
  };

  const makePreview = (host: HTMLElement, toy: ToyLike, index: number) => {
    if (!webglAvailable) return;
    const key = toy.slug ?? `toy-${index}`;
    if (previews.has(key)) return;

    if (!previewObserver && typeof IntersectionObserver !== 'undefined') {
      previewObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const previewKey = (entry.target as HTMLElement).dataset.previewKey;
            if (!previewKey) return;
            const item = previews.get(previewKey);
            if (!item) return;
            item.isVisible = entry.isIntersecting;
            if (!entry.isIntersecting) item.hoverStrength = 0;
          });
        },
        { root: null, rootMargin: '80px', threshold: 0.01 },
      );
    }

    const previewRoot = document.createElement('div');
    previewRoot.className = 'webtoy-card-preview';
    previewRoot.dataset.previewKey = key;
    host.prepend(previewRoot);

    const style = pickPreviewStyle(toy, index);
    let isActive = index === 0;
    const activate = () => {
      isActive = true;
      const item = previews.get(key);
      if (!item) return;
      item.isActive = true;
      item.hoverStrength = 0.35;
    };
    const deactivate = () => {
      isActive = false;
      const item = previews.get(key);
      if (!item) return;
      item.isActive = false;
      item.hoverStrength = 0;
    };
    previewRoot.addEventListener('pointerenter', activate);
    previewRoot.addEventListener('focusin', activate);
    previewRoot.addEventListener('pointerleave', deactivate);
    previewRoot.addEventListener('focusout', deactivate);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: false });
    } catch (_error) {
      previewRoot.remove();
      return;
    }
    renderer.setSize(180, 110, false);
    renderer.setPixelRatio(1);
    previewRoot.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x090a16);
    const camera = new PerspectiveCamera(55, 180 / 110, 0.1, 100);
    camera.position.z = 2.7;

    const group = new Group();
    scene.add(group);

    const materialColor = new Color(style.baseColor);
    const surfaceTexture = getTexture(style.surfaceTexture, {
      anisotropy: getTextureAnisotropy(renderer),
      colorSpace: SRGBColorSpace,
      repeatX: 1.8,
      repeatY: 1.8,
    });
    const detailTexture = getTexture(style.detailTexture, {
      anisotropy: getTextureAnisotropy(renderer),
      repeatX: 2.6,
      repeatY: 2.6,
    });
    const material = new MeshStandardMaterial({
      color: materialColor,
      emissive: materialColor.clone().multiplyScalar(style.emissiveMultiplier),
      map: surfaceTexture,
      emissiveMap: surfaceTexture,
      bumpMap: detailTexture,
      bumpScale: 0.08,
      roughnessMap: detailTexture,
      roughness: style.roughness,
      metalness: style.metalness,
    });
    const mesh = new Mesh(style.geometry(), material);
    group.add(mesh);

    const overlay = new Mesh(
      new PlaneGeometry(2.6, 1.8, 1, 1),
      new MeshBasicMaterial({
        color: materialColor.clone().offsetHSL(0.08, 0, 0.08),
        map: getTexture(AMBIENT_AURA_TEXTURE, {
          colorSpace: SRGBColorSpace,
          generateMipmaps: false,
          wrapping: MirroredRepeatWrapping,
        }),
        alphaMap: getTexture(AMBIENT_AURA_TEXTURE, {
          generateMipmaps: false,
          wrapping: MirroredRepeatWrapping,
        }),
        transparent: true,
        opacity: style.overlayOpacity,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    overlay.position.z = -0.85;
    scene.add(overlay);

    scene.add(new AmbientLight(0xffffff, 0.48));
    const light = new DirectionalLight(0xffffff, 1.2);
    light.position.copy(new Vector3(2, 3, 3));
    scene.add(light);

    const composer = createComposer(
      renderer,
      scene,
      camera,
      new Vector2(180, 110),
      0.45,
    );
    composer.render();

    const dispose = () => {
      previewObserver?.unobserve(previewRoot);
      previewRoot.removeEventListener('pointerenter', activate);
      previewRoot.removeEventListener('focusin', activate);
      previewRoot.removeEventListener('pointerleave', deactivate);
      previewRoot.removeEventListener('focusout', deactivate);
      (mesh.geometry as BufferGeometry).dispose();
      (mesh.material as Material).dispose();
      (overlay.geometry as BufferGeometry).dispose();
      (overlay.material as Material).dispose();
      composer.dispose();
      renderer.dispose();
      previewRoot.remove();
    };

    previewObserver?.observe(previewRoot);

    previews.set(key, {
      composer,
      root: host,
      renderer,
      scene,
      camera,
      mesh,
      overlay,
      group,
      style,
      isVisible: true,
      isActive,
      hoverStrength: isActive ? 0.2 : 0,
      dispose,
    });
  };

  const syncCardPreviews = (cards: HTMLElement[], toys: ToyLike[]) => {
    const nextKeys = new Set<string>();
    cards.slice(0, previewLimit).forEach((card, index) => {
      const toy = toys[index];
      if (!toy || !webglAvailable) return;
      const key = toy.slug ?? `toy-${index}`;
      nextKeys.add(key);
      if (!previews.has(key)) makePreview(card, toy, index);
    });

    Array.from(previews.entries()).forEach(([key, preview]) => {
      if (nextKeys.has(key)) return;
      preview.dispose();
      previews.delete(key);
    });
  };

  return {
    init() {
      createAmbientLayer();
      visibilityHandler = () => {
        if (!document.hidden) {
          lastBackgroundRenderAt = 0;
          lastPreviewRenderAt = 0;
        }
      };
      pointerMoveHandler = (event: PointerEvent) => {
        const width = Math.max(window.innerWidth, 1);
        const height = Math.max(window.innerHeight, 1);
        pointerState.targetX = (event.clientX / width) * 2 - 1;
        pointerState.targetY = (event.clientY / height) * 2 - 1;
      };
      pointerLeaveHandler = () => {
        pointerState.targetX = 0;
        pointerState.targetY = 0;
      };
      document.addEventListener('visibilitychange', visibilityHandler);
      window.addEventListener('pointermove', pointerMoveHandler, {
        passive: true,
      });
      window.addEventListener('pointerleave', pointerLeaveHandler);
      animationFrame = window.requestAnimationFrame(animate);
    },
    syncCardPreviews,
    triggerLaunchTransition() {
      pulse = 1;
    },
    startLaunchTransition(card?: HTMLElement | null) {
      pulse = 1;
      launchState.active = true;
      launchState.targetStrength = 1;
      launchState.expiresAt =
        typeof performance !== 'undefined' ? performance.now() + 260 : 260;
      if (card) {
        const rect = card.getBoundingClientRect();
        launchState.cardX =
          (rect.left + rect.width * 0.5) / Math.max(window.innerWidth, 1);
        launchState.cardY =
          (rect.top + rect.height * 0.5) / Math.max(window.innerHeight, 1);
      } else {
        launchState.cardX = 0.5;
        launchState.cardY = 0.5;
      }
    },
    dispose() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
      if (pointerMoveHandler) {
        window.removeEventListener('pointermove', pointerMoveHandler);
        pointerMoveHandler = null;
      }
      if (pointerLeaveHandler) {
        window.removeEventListener('pointerleave', pointerLeaveHandler);
        pointerLeaveHandler = null;
      }
      previews.forEach((preview) => preview.dispose());
      previews.clear();
      previewObserver?.disconnect();
      previewObserver = null;
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      if (backgroundParticles) {
        (backgroundParticles.geometry as BufferGeometry).dispose();
        (backgroundParticles.material as Material).dispose();
      }
      if (backgroundShards) {
        (backgroundShards.geometry as BufferGeometry).dispose();
        (backgroundShards.material as Material).dispose();
      }
      if (ambientBackdrop) {
        (ambientBackdrop.geometry as BufferGeometry).dispose();
        (ambientBackdrop.material as Material).dispose();
      }
      backgroundComposer?.dispose();
      backgroundRenderer?.dispose();
      backgroundRenderer?.domElement.remove();
      backgroundRenderer = null;
      backgroundScene = null;
      backgroundCamera = null;
      backgroundParticles = null;
      backgroundShards = null;
      backgroundShardStates = [];
      ambientBackdrop = null;
      backgroundComposer = null;
      loadedTextures.forEach((texture) => texture.dispose());
      loadedTextures.clear();
    },
  };
}
