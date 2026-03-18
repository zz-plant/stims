import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
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
  dispose: () => void;
}

const BACKGROUND_FRAME_INTERVAL_MS = 1000 / 30;
const PREVIEW_FRAME_INTERVAL_MS = 1000 / 24;

export function createLibraryThreeEffects() {
  let backgroundRenderer: WebGLRenderer | null = null;
  let backgroundScene: Scene | null = null;
  let backgroundCamera: PerspectiveCamera | null = null;
  let backgroundParticles: Points | null = null;
  let animationFrame = 0;
  let pulse = 0;
  let resizeHandler: (() => void) | null = null;
  let previewObserver: IntersectionObserver | null = null;
  let visibilityHandler: (() => void) | null = null;
  const backgroundColor = new Color(0x0b0d16);
  const previews = new Map<string, PreviewItem>();
  let lastBackgroundRenderAt = 0;
  let lastPreviewRenderAt = 0;

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
  const previewLimit = prefersReducedMotion ? 0 : isCompactViewport ? 2 : 4;

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
        if (!item.isVisible) return;
        item.mesh.rotation.x += 0.004 + pulse * 0.01;
        item.mesh.rotation.y += 0.007 + pulse * 0.01;
        item.renderer.render(item.scene, item.camera);
      });
    }

    pulse = Math.max(0, pulse * 0.93 - 0.003);
  };

  const createAmbientLayer = () => {
    if (!webglAvailable) return;
    try {
      const renderer = new WebGLRenderer({ alpha: true, antialias: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
        transparent: true,
        opacity: 0.4,
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

      scene.add(points);
      scene.add(new AmbientLight(0x8899ff, 0.35));

      document.body.appendChild(renderer.domElement);
      backgroundRenderer = renderer;
      backgroundScene = scene;
      backgroundCamera = camera;
      backgroundParticles = points;

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
    const material = new MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.24),
      roughness: 0.38,
      metalness: 0.62,
    });
    const mesh = new Mesh(geometry, material);
    group.add(mesh);

    scene.add(new AmbientLight(0xffffff, 0.4));
    const light = new DirectionalLight(0xffffff, 1.1);
    light.position.copy(new Vector3(2, 3, 3));
    scene.add(light);

    const dispose = () => {
      previewObserver?.unobserve(previewRoot);
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
      backgroundRenderer?.dispose();
      backgroundRenderer?.domElement.remove();
      backgroundRenderer = null;
      backgroundScene = null;
      backgroundCamera = null;
      backgroundParticles = null;
    },
  };
}
