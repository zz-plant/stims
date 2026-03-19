import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusKnotGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

interface ToyLike {
  slug?: string;
}

interface PreviewItem {
  root: HTMLElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mesh: Mesh;
  isVisible: boolean;
  isActive: boolean;
  dispose: () => void;
}

const BACKGROUND_FRAME_INTERVAL_MS = 1000 / 20;
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
  repeatX?: number;
  repeatY?: number;
  wrapping?: Texture['wrapS'];
  colorSpace?: typeof SRGBColorSpace;
};

export function createLibraryThreeEffects() {
  let backgroundRenderer: WebGLRenderer | null = null;
  let backgroundScene: Scene | null = null;
  let backgroundCamera: PerspectiveCamera | null = null;
  let backgroundParticles: Points | null = null;
  let ambientBackdrop: Mesh | null = null;
  let animationFrame = 0;
  let pulse = 0;
  let resizeHandler: (() => void) | null = null;
  let previewObserver: IntersectionObserver | null = null;
  let visibilityHandler: (() => void) | null = null;
  const backgroundColor = new Color(0x0b0d16);
  const previews = new Map<string, PreviewItem>();
  const textureLoader = new TextureLoader();
  const loadedTextures = new Map<string, Texture>();
  let lastBackgroundRenderAt = 0;
  let lastPreviewRenderAt = 0;

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
      repeatX = 1,
      repeatY = repeatX,
      wrapping = RepeatWrapping,
      colorSpace,
    } = config;
    const cacheKey = JSON.stringify({
      colorSpace: colorSpace ?? 'default',
      fileName,
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
    if (colorSpace) {
      texture.colorSpace = colorSpace;
    }
    loadedTextures.set(cacheKey, texture);
    return texture;
  };

  const hashSlug = (value: string) => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
  };

  const getPreviewTextureSet = (toy: ToyLike, index: number) => {
    const seed = hashSlug(toy.slug ?? `toy-${index}`);
    return {
      surface: PREVIEW_SURFACE_TEXTURES[seed % PREVIEW_SURFACE_TEXTURES.length],
      detail:
        PREVIEW_DETAIL_TEXTURES[
          Math.floor(seed / PREVIEW_SURFACE_TEXTURES.length) %
            PREVIEW_DETAIL_TEXTURES.length
        ],
    };
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
  const previewLimit = prefersReducedMotion ? 0 : isCompactViewport ? 1 : 2;

  const shouldRender = () =>
    typeof document === 'undefined' ? true : !document.hidden;

  const animate = (now: number) => {
    animationFrame = window.requestAnimationFrame(animate);
    if (!shouldRender()) return;

    if (
      backgroundRenderer &&
      backgroundScene &&
      backgroundCamera &&
      now - lastBackgroundRenderAt >= BACKGROUND_FRAME_INTERVAL_MS
    ) {
      lastBackgroundRenderAt = now;
      const time = now * 0.0002;
      if (backgroundParticles) {
        backgroundParticles.rotation.y = time * (0.18 + pulse * 0.6);
        backgroundParticles.rotation.x = Math.sin(time * 2) * 0.07;
      }
      if (ambientBackdrop) {
        ambientBackdrop.rotation.z = Math.sin(time * 1.7) * 0.08;
        ambientBackdrop.position.x = Math.sin(time * 1.3) * 0.8;
        ambientBackdrop.position.y = Math.cos(time * 1.1) * 0.5;
      }
      backgroundColor.setHSL(
        0.68 + Math.sin(time) * 0.05,
        0.35,
        0.05 + pulse * 0.02,
      );
      backgroundScene.background = backgroundColor;
      backgroundRenderer.render(backgroundScene, backgroundCamera);
    }

    if (now - lastPreviewRenderAt >= PREVIEW_FRAME_INTERVAL_MS) {
      lastPreviewRenderAt = now;
      previews.forEach((item) => {
        if (!item.isVisible || !item.isActive) return;
        item.mesh.rotation.x += 0.004 + pulse * 0.01;
        item.mesh.rotation.y += 0.007 + pulse * 0.01;
        item.renderer.render(item.scene, item.camera);
      });
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
        new MeshBasicMaterial({
          color: 0xffffff,
          map: getTexture(AMBIENT_AURA_TEXTURE, {
            colorSpace: SRGBColorSpace,
            wrapping: MirroredRepeatWrapping,
          }),
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        }),
      );
      backdrop.position.z = -8;

      scene.add(backdrop);
      scene.add(points);
      scene.add(new AmbientLight(0x8899ff, 0.35));

      document.body.appendChild(renderer.domElement);
      backgroundRenderer = renderer;
      backgroundScene = scene;
      backgroundCamera = camera;
      backgroundParticles = points;
      ambientBackdrop = backdrop;

      resizeHandler = () => {
        if (!backgroundRenderer || !backgroundCamera) return;
        backgroundRenderer.setSize(window.innerWidth, window.innerHeight);
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
            const key = (entry.target as HTMLElement).dataset.previewKey;
            if (!key) return;
            const item = previews.get(key);
            if (!item) return;
            item.isVisible = entry.isIntersecting;
          });
        },
        { root: null, rootMargin: '80px', threshold: 0.01 },
      );
    }

    const previewRoot = document.createElement('div');
    previewRoot.className = 'webtoy-card-preview';
    previewRoot.dataset.previewKey = key;
    host.prepend(previewRoot);

    let isActive = index === 0;
    const activate = () => {
      isActive = true;
      const item = previews.get(key);
      if (item) item.isActive = true;
    };
    const deactivate = () => {
      isActive = false;
      const item = previews.get(key);
      if (item) item.isActive = false;
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

    let geometry: BufferGeometry;
    if (index % 3 === 0) geometry = new TorusKnotGeometry(0.56, 0.18, 92, 12);
    else if (index % 3 === 1) geometry = new SphereGeometry(0.72, 26, 26);
    else geometry = new BoxGeometry(1.1, 1.1, 1.1, 5, 5, 5);

    const color = new Color().setHSL(((index * 0.13) % 1) + 0.05, 0.8, 0.6);
    const textureSet = getPreviewTextureSet(toy, index);
    const material = new MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.24),
      map: getTexture(textureSet.surface, {
        colorSpace: SRGBColorSpace,
        repeatX: 1.8,
        repeatY: 1.8,
      }),
      emissiveMap: getTexture(textureSet.surface, {
        colorSpace: SRGBColorSpace,
        repeatX: 1.8,
        repeatY: 1.8,
      }),
      bumpMap: getTexture(textureSet.detail, {
        repeatX: 2.6,
        repeatY: 2.6,
      }),
      bumpScale: 0.08,
      roughness: 0.38,
      metalness: 0.62,
    });
    const mesh = new Mesh(geometry, material);
    group.add(mesh);

    scene.add(new AmbientLight(0xffffff, 0.4));
    const light = new DirectionalLight(0xffffff, 1.1);
    light.position.copy(new Vector3(2, 3, 3));
    scene.add(light);
    renderer.render(scene, camera);

    const dispose = () => {
      previewObserver?.unobserve(previewRoot);
      previewRoot.removeEventListener('pointerenter', activate);
      previewRoot.removeEventListener('focusin', activate);
      previewRoot.removeEventListener('pointerleave', deactivate);
      previewRoot.removeEventListener('focusout', deactivate);
      (mesh.geometry as BufferGeometry).dispose();
      (mesh.material as Material).dispose();
      renderer.dispose();
      previewRoot.remove();
    };

    previewObserver?.observe(previewRoot);

    previews.set(key, {
      root: host,
      renderer,
      scene,
      camera,
      mesh,
      isVisible: true,
      isActive,
      dispose,
    });
  };

  const syncCardPreviews = (cards: HTMLElement[], toys: ToyLike[]) => {
    const nextKeys = new Set<string>();
    cards.slice(0, previewLimit).forEach((card, index) => {
      const toy = toys[index];
      if (!toy) return;
      if (!webglAvailable) return;
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
      document.addEventListener('visibilitychange', visibilityHandler);
      animationFrame = window.requestAnimationFrame(animate);
    },
    syncCardPreviews,
    triggerLaunchTransition() {
      pulse = 1;
    },
    dispose() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
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
      if (ambientBackdrop) {
        (ambientBackdrop.geometry as BufferGeometry).dispose();
        (ambientBackdrop.material as Material).dispose();
      }
      backgroundRenderer?.dispose();
      backgroundRenderer?.domElement.remove();
      backgroundRenderer = null;
      backgroundScene = null;
      backgroundCamera = null;
      backgroundParticles = null;
      ambientBackdrop = null;
      loadedTextures.forEach((texture) => texture.dispose());
      loadedTextures.clear();
    },
  };
}
