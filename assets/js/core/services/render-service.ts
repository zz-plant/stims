import type * as THREE from 'three';
import { createSharedInitializer } from '../../utils/shared-initializer';
import {
  getActiveRenderPreferences,
  subscribeToRenderPreferences,
} from '../render-preferences.ts';
import {
  getRendererCapabilities,
  type RendererBackend,
  type RendererCapabilities,
  rememberRendererFallback,
} from '../renderer-capabilities.ts';
import {
  applyRendererSettings,
  resolveRendererSettings,
} from '../renderer-settings.ts';
import {
  initRenderer,
  type RendererInitConfig,
  type RendererInitResult,
} from '../renderer-setup.ts';
import {
  getActiveQualityPreset,
  type QualityPreset,
  subscribeToQualityPreset,
} from '../settings-panel.ts';
import type { WebGPURenderer } from '../webgpu-renderer.ts';

export type RendererHandle = {
  renderer: THREE.WebGLRenderer | WebGPURenderer;
  backend: RendererBackend;
  info: RendererInitResult;
  canvas: HTMLCanvasElement;
  applySettings: (options?: Partial<RendererInitConfig>) => void;
  release: () => void;
};

type RendererPoolEntry = {
  handle: RendererHandle;
  inUse: boolean;
};

const rendererPool: RendererPoolEntry[] = [];
let activeQuality: QualityPreset = getActiveQualityPreset();
let activeRenderPreferences = getActiveRenderPreferences();
const rendererCapabilitiesInitializer =
  createSharedInitializer<RendererCapabilities>(getRendererCapabilities);

function getRenderDefaults(): Partial<RendererInitConfig> {
  return {
    maxPixelRatio:
      activeRenderPreferences.maxPixelRatio ?? activeQuality.maxPixelRatio,
    renderScale:
      activeRenderPreferences.renderScale ?? activeQuality.renderScale ?? 1,
  };
}

function forEachActiveRenderer(update: (entry: RendererPoolEntry) => void) {
  for (const entry of rendererPool) {
    if (!entry.inUse) {
      continue;
    }
    update(entry);
  }
}

subscribeToQualityPreset((preset) => {
  activeQuality = preset;
  forEachActiveRenderer((entry) => entry.handle.applySettings());
});

subscribeToRenderPreferences((preferences) => {
  activeRenderPreferences = preferences;
  forEachActiveRenderer((entry) => entry.handle.applySettings());
});

function buildSettings(
  options: Partial<RendererInitConfig> = {},
  info?: RendererInitResult | null,
): RendererInitConfig {
  return resolveRendererSettings(options, info, getRenderDefaults());
}

function applyPoolSettings(
  renderer: THREE.WebGLRenderer | WebGPURenderer,
  info: RendererInitResult,
  options: Partial<RendererInitConfig> = {},
) {
  applyRendererSettings(renderer, info, options, getRenderDefaults());
}

async function createRendererHandle(
  canvas: HTMLCanvasElement,
  options: Partial<RendererInitConfig>,
  initRendererImpl: typeof initRenderer,
): Promise<RendererHandle> {
  const initResult = await initRendererImpl(canvas, buildSettings(options));
  if (!initResult) {
    rememberRendererFallback('Renderer initialization failed.');
    throw new Error('Unable to initialize renderer.');
  }

  const handle: RendererHandle = {
    renderer: initResult.renderer,
    backend: initResult.backend,
    info: initResult,
    canvas,
    applySettings: (nextOptions) =>
      applyPoolSettings(initResult.renderer, initResult, nextOptions),
    release: () => {},
  };

  return handle;
}

function attachCanvas(canvas: HTMLCanvasElement, host?: HTMLElement) {
  if (!host) {
    return;
  }

  if (canvas.parentElement !== host) {
    host.appendChild(canvas);
  }
}

function detachCanvas(canvas: HTMLCanvasElement) {
  if (canvas.parentElement) {
    canvas.parentElement.removeChild(canvas);
  }
}

export async function requestRenderer({
  host,
  options = {},
  canvas: providedCanvas,
  initRendererImpl = initRenderer,
}: {
  host?: HTMLElement | null;
  options?: Partial<RendererInitConfig>;
  canvas?: HTMLCanvasElement | null;
  initRendererImpl?: typeof initRenderer;
} = {}): Promise<RendererHandle> {
  const entry = rendererPool.find((candidate) => !candidate.inUse);

  if (entry) {
    entry.inUse = true;
    attachCanvas(entry.handle.canvas, host ?? undefined);
    entry.handle.applySettings(options);
    return entry.handle;
  }

  const canvas = providedCanvas ?? document.createElement('canvas');
  attachCanvas(canvas, host ?? undefined);

  const handle = await createRendererHandle(canvas, options, initRendererImpl);

  const poolEntry: RendererPoolEntry = {
    handle,
    inUse: true,
  };

  handle.release = () => {
    handle.renderer.setAnimationLoop?.(null);
    poolEntry.inUse = false;
    detachCanvas(handle.canvas);
  };

  rendererPool.push(poolEntry);
  return handle;
}

export async function prewarmRendererCapabilities() {
  return rendererCapabilitiesInitializer.run();
}

export function resetRendererPool({
  dispose = false,
}: {
  dispose?: boolean;
} = {}) {
  rendererPool.forEach((entry) => {
    entry.inUse = false;
    if (dispose) {
      entry.handle.renderer.setAnimationLoop?.(null);
      entry.handle.renderer.dispose?.();
      detachCanvas(entry.handle.canvas);
    }
  });
  if (dispose) {
    rendererPool.splice(0, rendererPool.length);
  }
  rendererCapabilitiesInitializer.reset();
}
