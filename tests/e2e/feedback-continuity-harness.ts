/**
 * In-page harness for `feedback-continuity.test.ts`.
 *
 * Loaded into a real browser through the Vite dev server (the test imports it
 * by URL inside `page.evaluate`), so it drives the production feedback
 * managers against a real WebGL or WebGPU context — no app shell, no preset
 * compiler, no frame loop, and therefore none of their gates or timing.
 *
 * The source scene is a single bright quad in one quadrant: an image with
 * structure on both axes, so a copy that lands blank, shifted or flipped
 * reads differently from the original.
 */
import {
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Texture,
  UnsignedByteType,
  WebGLRenderer,
} from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { createMilkdropWebGLFeedbackManager } from '../../src/js/milkdrop/feedback-manager-webgl.ts';
import { createMilkdropWebGPUFeedbackManager } from '../../src/js/milkdrop/feedback-manager-webgpu.ts';

export type FeedbackHarnessBackend = 'webgl' | 'webgpu';

/**
 * What the source scene draws: the outgoing preset's quad (top-left), the
 * incoming preset's (bottom-right), or nothing, so the feedback history is
 * all that is left on screen.
 */
export type FeedbackHarnessScene = 'outgoing' | 'incoming' | 'empty';

/** Mean luminance (0-255) per quadrant: [top-left, top-right, bottom-left, bottom-right]. */
export type QuadrantLuminance = [number, number, number, number];

const WIDTH = 320;
const HEIGHT = 180;

type HarnessRenderer = {
  render(scene: Scene, camera: OrthographicCamera): void;
  setRenderTarget(target: unknown): void;
  dispose(): void;
};

type HarnessManager = {
  render(
    renderer: HarnessRenderer,
    scene: Scene,
    camera: OrthographicCamera,
  ): boolean;
  renderOffscreen(
    renderer: HarnessRenderer,
    scene: Scene,
    camera: OrthographicCamera,
  ): boolean;
  getDisplayTexture(): Texture | null;
  setTransitionSource(texture: Texture | null): void;
  seedHistoryFrom(renderer: HarnessRenderer, source: HarnessManager): boolean;
  saveCurrentFrame(): void;
  setTransitionBlend(alpha: number): void;
  setAdaptiveQuality(options: { feedbackResolutionMultiplier: number }): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

function quadrantLuminance(
  pixels: ArrayLike<number>,
  rowsBottomUp: boolean,
): QuadrantLuminance {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let row = 0; row < HEIGHT; row += 1) {
    const y = rowsBottomUp ? HEIGHT - 1 - row : row;
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (row * WIDTH + x) * 4;
      const quadrant = (y < HEIGHT / 2 ? 0 : 2) + (x < WIDTH / 2 ? 0 : 1);
      sums[quadrant] +=
        0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      counts[quadrant] += 1;
    }
  }
  return sums.map((sum, q) => sum / counts[q]) as QuadrantLuminance;
}

export async function createFeedbackHarness(backend: FeedbackHarnessBackend) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);

  let renderer: HarnessRenderer;
  let readFrame: () => Promise<QuadrantLuminance>;
  let disposeReadback = () => {};

  if (backend === 'webgpu') {
    const webgpu = new WebGPURenderer({ canvas, antialias: false });
    webgpu.setSize(WIDTH, HEIGHT, false);
    await webgpu.init();
    // A presented WebGPU canvas cannot be read back reliably (headed
    // Chromium returns transparent black), so what the manager presents to
    // "the screen" lands in this target instead, and is read from there.
    const output = new RenderTarget(WIDTH, HEIGHT, { type: UnsignedByteType });
    webgpu.setOutputRenderTarget(output);
    renderer = webgpu as unknown as HarnessRenderer;
    readFrame = async () =>
      quadrantLuminance(
        (await webgpu.readRenderTargetPixelsAsync(
          output,
          0,
          0,
          WIDTH,
          HEIGHT,
        )) as Uint8Array,
        false,
      );
    disposeReadback = () => output.dispose();
  } else {
    const webgl = new WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    webgl.setSize(WIDTH, HEIGHT, false);
    renderer = webgl as unknown as HarnessRenderer;
    const gl = webgl.getContext();
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    readFrame = async () => {
      gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return quadrantLuminance(pixels, true);
    };
  }

  const createManager = () =>
    (backend === 'webgpu'
      ? createMilkdropWebGPUFeedbackManager(WIDTH, HEIGHT)
      : createMilkdropWebGLFeedbackManager(
          WIDTH,
          HEIGHT,
        )) as unknown as HarnessManager;

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  camera.position.z = 1;

  /** A source scene of one bright quad; see FeedbackHarnessScene. */
  const createQuadScene = () => {
    const scene = new Scene();
    const quad = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    scene.add(quad);
    const setScene = (drawing: FeedbackHarnessScene) => {
      quad.visible = drawing !== 'empty';
      // Quadrant centres of the [-1, 1] clip square.
      if (drawing === 'incoming') quad.position.set(0.5, -0.5, 0);
      else quad.position.set(-0.5, 0.5, 0);
    };
    setScene('outgoing');
    return {
      scene,
      setScene,
      /** Puts the quad's centre at (x, y) in clip space. */
      moveQuad: (x: number, y: number) => quad.position.set(x, y, 0),
      dispose: () => {
        quad.geometry.dispose();
        quad.material.dispose();
      },
    };
  };

  /**
   * The textures a manager's next frame samples from its own past: the
   * feedback history, plus the blur levels the WebGL composite reads from
   * the previous frame, or the display history WebGPU's afterimage reads.
   * These are the managers' private targets — what seeding has to carry.
   */
  type CarriedTarget = { texture: Texture; width: number; height: number };
  const carriedTargets = (target: HarnessManager): CarriedTarget[] => {
    const internals = target as unknown as {
      readTarget: CarriedTarget;
      blurTargets?: CarriedTarget[];
      displayTargets?: CarriedTarget[];
    };
    return [
      internals.readTarget,
      ...(backend === 'webgpu'
        ? (internals.displayTargets ?? [])
        : (internals.blurTargets ?? [])),
    ];
  };
  const clearingRenderer = renderer as unknown as {
    setRenderTarget(target: unknown): void;
    readRenderTargetPixels?: (
      target: unknown,
      x: number,
      y: number,
      w: number,
      h: number,
      buffer: ArrayBufferView,
    ) => void;
    readRenderTargetPixelsAsync?: (
      target: unknown,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => Promise<ArrayBufferView>;
  };
  const halfToFloat = (bits: number) => {
    const exponent = (bits & 0x7c00) >> 10;
    const fraction = bits & 0x03ff;
    const sign = bits & 0x8000 ? -1 : 1;
    if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
    if (exponent === 31) return fraction ? Number.NaN : sign * Infinity;
    return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  };
  const meanRed = async (target: CarriedTarget) => {
    const { width, height } = target;
    const halfFloat = target.texture.type === 1016; // HalfFloatType
    let pixels: ArrayLike<number>;
    if (backend === 'webgpu' && clearingRenderer.readRenderTargetPixelsAsync) {
      pixels = (await clearingRenderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        width,
        height,
      )) as unknown as ArrayLike<number>;
    } else {
      const buffer = halfFloat
        ? new Uint16Array(width * height * 4)
        : new Uint8Array(width * height * 4);
      clearingRenderer.readRenderTargetPixels?.(
        target,
        0,
        0,
        width,
        height,
        buffer,
      );
      pixels = buffer;
    }
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      sum += halfFloat ? halfToFloat(pixels[i]) : pixels[i] / 255;
    }
    return sum / (pixels.length / 4);
  };

  const manager = createManager();
  const source = createQuadScene();
  const scene = source.scene;
  const decks: Array<{ dispose(): void }> = [];

  return {
    /** Renders one frame and returns what it presented. */
    async renderFrame(): Promise<QuadrantLuminance> {
      manager.render(renderer, scene, camera);
      return readFrame();
    },
    /** What the scene draws from the next frame on; see FeedbackHarnessScene. */
    setScene: source.setScene,
    moveQuad: source.moveQuad,
    saveCurrentFrame: () => manager.saveCurrentFrame(),
    setTransitionBlend: (alpha: number) => manager.setTransitionBlend(alpha),
    setFeedbackResolution(multiplier: number) {
      manager.setAdaptiveQuality({ feedbackResolutionMultiplier: multiplier });
      // Growing the targets is deferred a frame and shrinking is immediate;
      // settle both now so the caller sees the new size on the next frame.
      manager.resize(WIDTH, HEIGHT);
    },
    /**
     * A second feedback manager on the same renderer, with its own scene —
     * the other deck of a live crossfade. It never presents: it renders
     * offscreen for this harness's present pass to dissolve out of.
     */
    addDeck() {
      const deckManager = createManager();
      const deckSource = createQuadScene();
      const deck = {
        manager: deckManager,
        setScene: deckSource.setScene,
        moveQuad: deckSource.moveQuad,
        renderOffscreen: () =>
          deckManager.renderOffscreen(renderer, deckSource.scene, camera),
        dispose() {
          deckManager.dispose();
          deckSource.dispose();
        },
      };
      decks.push(deck);
      return deck;
    },
    /** Dissolves out of `deck`'s live frame, or back to the snapshot. */
    setTransitionSource(deck: { manager: HarnessManager } | null) {
      manager.setTransitionSource(deck?.manager.getDisplayTexture() ?? null);
    },
    /** Starts this harness's feedback history from `deck`'s. */
    seedHistoryFrom: (deck: { manager: HarnessManager }) =>
      manager.seedHistoryFrom(renderer, deck.manager),
    /** Fills each of `deck`'s carried targets with its own flat linear
     * grey, `base + index * step`, so a slot copied to the wrong place reads
     * wrong. Drawn, not cleared: a clear is never resolved out of a
     * multisampled target (WebGL's blur levels). */
    paintCarried(
      deck: { manager: HarnessManager },
      base: number,
      step: number,
    ) {
      const material = new MeshBasicMaterial({ depthTest: false });
      material.blending = NoBlending;
      const quad = new Mesh(new PlaneGeometry(2, 2), material);
      const paintScene = new Scene();
      paintScene.add(quad);
      carriedTargets(deck.manager).forEach((target, index) => {
        material.color.setScalar(base + index * step);
        clearingRenderer.setRenderTarget(target);
        renderer.render(paintScene, camera);
      });
      clearingRenderer.setRenderTarget(null);
      quad.geometry.dispose();
      material.dispose();
    },
    /** Mean red (0-1) of each carried target — of `deck`, or this
     * harness's own manager. */
    readCarried: async (deck?: { manager: HarnessManager }) =>
      Promise.all(
        carriedTargets(deck?.manager ?? manager).map((target) =>
          meanRed(target),
        ),
      ),
    dispose() {
      for (const deck of decks) deck.dispose();
      manager.dispose();
      source.dispose();
      disposeReadback();
      renderer.dispose();
      canvas.remove();
    },
  };
}
