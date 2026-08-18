import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { cloneBlendState } from '../../src/js/milkdrop/runtime/session.ts';

type ServiceWorkerHandler = (event: {
  request?: { method: string; mode: string; url: string };
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (work: Promise<unknown>) => void;
}) => void;

function loadServiceWorker(options: {
  add?: (asset: string) => Promise<unknown>;
  fetch?: (request: unknown) => Promise<Response>;
  put?: (request: unknown, response: Response) => Promise<unknown>;
}) {
  const source = readFileSync(
    join(import.meta.dir, '..', '..', 'public', 'service-worker.js'),
    'utf8',
  );
  const handlers = new Map<string, ServiceWorkerHandler>();
  const cache = {
    add: options.add ?? (() => Promise.resolve()),
    async addAll(assets: string[]) {
      await Promise.all(assets.map((asset) => this.add(asset)));
    },
    put: options.put ?? (() => Promise.resolve()),
  };
  let skipWaitingCalls = 0;
  runInNewContext(source, {
    URL,
    Response,
    caches: {
      delete: () => Promise.resolve(true),
      keys: () => Promise.resolve([]),
      match: () => Promise.resolve(undefined),
      open: () => Promise.resolve(cache),
    },
    clients: { claim: () => Promise.resolve() },
    fetch:
      options.fetch ??
      (() => Promise.resolve(new Response('fresh', { status: 200 }))),
    self: {
      addEventListener: (name: string, handler: ServiceWorkerHandler) => {
        handlers.set(name, handler);
      },
      skipWaiting: () => {
        skipWaitingCalls += 1;
      },
      location: {
        origin: 'https://toil.fyi',
      },
    },
  });
  return {
    handlers,
    get skipWaitingCalls() {
      return skipWaitingCalls;
    },
  };
}

describe('Workspace performance regressions', () => {
  test('keeps the root shell on the fallback catalog until the runtime is mounted', () => {
    const shellHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-shell-hooks.ts',
      ),
      'utf8',
    );

    expect(shellHookSource).toContain(
      'const rawCatalog = runtimeCatalogReady ? runtimeCatalog : fallbackCatalog;',
    );
  });

  test('loads the MilkDrop runtime lazily instead of importing it into the app shell eagerly', () => {
    const sessionSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'engine',
        'milkdrop-engine-session.ts',
      ),
      'utf8',
    );
    const hookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-hooks.ts',
      ),
      'utf8',
    );

    expect(sessionSource).toContain(`import('../../milkdrop/runtime.ts')`);
    expect(sessionSource).toContain(
      `import('../../core/toy-runtime-starter.ts')`,
    );
    expect(sessionSource).toContain('await loadRuntimeFactories()');
    expect(hookSource).not.toContain(
      'void engineRef.current.mount(stage, initialLaunchIntentRef.current);',
    );
  });

  test('keeps heavy startup data and audio capture behind staged lazy loading', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'app.ts'),
      'utf8',
    );
    const catalogHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'hooks',
        'use-catalog-loading.ts',
      ),
      'utf8',
    );
    const shellHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-shell-hooks.ts',
      ),
      'utf8',
    );

    expect(appSource).not.toContain(
      "import { stopAllAudioForBfcache } from './core/audio-handler.ts';",
    );
    expect(appSource).toContain("import('./core/audio-handler.ts')");
    expect(catalogHookSource).toContain('STARTER_CATALOG_URL');
    expect(catalogHookSource).toContain('scheduleBackgroundTask');
    expect(shellHookSource).not.toContain(
      "import { captureDisplayAudioStream } from '../ui/audio-advanced-sources.ts';",
    );
    expect(shellHookSource).toContain(
      "import(\n        '../ui/audio-advanced-sources.ts'",
    );
  });

  test('uses video frame callbacks for captured video when available', () => {
    const capturedVideoSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'core',
        'services',
        'captured-video-texture.ts',
      ),
      'utf8',
    );

    expect(capturedVideoSource).toContain('requestVideoFrameCallback');
    expect(capturedVideoSource).toContain('cancelVideoFrameCallback');
  });

  test('preserves blend frames when reusable custom-wave and motion-vector buffers are enabled', () => {
    const frameState = {
      customWaves: [
        {
          positions: [0, 0, 0, 1, 1, 0],
          color: { r: 1, g: 0.5, b: 0.25, a: 1 },
          alpha: 0.8,
          thickness: 2,
          drawMode: 'line',
          additive: false,
          pointSize: 4,
          spectrum: false,
        },
      ],
      motionVectors: [
        {
          positions: [0, 0, 0.18, 0.4, 0.5, 0.18],
          color: { r: 0.3, g: 0.6, b: 0.9, a: 1 },
          alpha: 0.5,
          thickness: 2,
          additive: false,
        },
      ],
      gpuGeometry: {
        customWaves: [
          {
            samples: [0.1, 0.2, 0.3],
            sampleValues2: [0.2, 0.3, 0.4],
            spectrum: true,
            centerX: 0,
            centerY: 0,
            scaling: 1,
            mystery: 0,
            time: 0,
            sampleCount: 3,
            signals: {
              time: 0,
              frame: 0,
              fps: 60,
              bass: 0,
              mid: 0,
              mids: 0,
              treble: 0,
              bassAtt: 0,
              midAtt: 0,
              midsAtt: 0,
              trebleAtt: 0,
              beat: 0,
              beatPulse: 0,
              rms: 0,
              vol: 0,
              music: 0,
              weightedEnergy: 0,
            },
            fieldProgram: null,
            color: { r: 1, g: 1, b: 1, a: 1 },
            alpha: 0.7,
            additive: false,
            thickness: 2,
          },
        ],
      },
    };

    const blendState = cloneBlendState(frameState as never);
    if (blendState?.mode !== 'gpu') {
      throw new Error('Expected a GPU blend state.');
    }

    const [customWave] = frameState.customWaves;
    const [motionVector] = frameState.motionVectors;
    const [proceduralWave] = frameState.gpuGeometry.customWaves;
    if (!customWave || !motionVector || !proceduralWave) {
      throw new Error('Expected test frame payloads to exist.');
    }
    customWave.positions[0] = 99;
    motionVector.positions[0] = 88;
    proceduralWave.samples[0] = 77;

    expect(blendState.previousFrame.customWaves[0]?.positions[0]).toBe(0);
    expect(blendState.previousFrame.motionVectors[0]?.positions[0]).toBe(0);
    expect(
      blendState.previousFrame.gpuGeometry.customWaves[0]?.samples[0],
    ).toBe(0.1);
  });

  test('double-buffers custom-wave and motion-vector visuals instead of allocating fresh frame arrays each tick', () => {
    const waveBuilderSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'milkdrop',
        'vm',
        'wave-builder.ts',
      ),
      'utf8',
    );
    const geometryBuilderSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'milkdrop',
        'vm',
        'geometry-builder.ts',
      ),
      'utf8',
    );

    expect(waveBuilderSource).toContain(
      'customWaveVisualFrames[nextFrameIndex]',
    );
    expect(waveBuilderSource).toContain(
      'proceduralCustomWaveFrames[nextFrameIndex]',
    );
    expect(geometryBuilderSource).toContain(
      'motionVectorVisualFrames[nextVisualFrameIndex]',
    );
    expect(geometryBuilderSource).toContain(
      'const vector = vectors[vectorCount]',
    );
  });

  test('memoizes browse sorting and visual-search catalog lookup work', () => {
    const browsePanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'BrowseSheetPanel.tsx',
      ),
      'utf8',
    );
    // The catalog-lookup memo moved out of SidePanel when "Match my music"
    // and "More like this" were merged into one finder panel; the guard
    // follows the code rather than the filename it used to live in.
    const finderPanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'PresetFinderPanel.tsx',
      ),
      'utf8',
    );

    expect(finderPanelSource).toContain('const catalogEntryById = useMemo');
    expect(finderPanelSource).toContain('catalogEntryById.get(match.presetId)');
    // The regression this guards: an O(catalog) scan per result row.
    expect(finderPanelSource).not.toContain('engine.catalog.find(');
    expect(browsePanelSource).toContain('const sorted = useMemo');
    expect(browsePanelSource).toContain('sortBrowseEntries(');
  });

  test('caches frontend preset search indexes instead of rebuilding haystacks per match', () => {
    const helperSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-helpers.ts',
      ),
      'utf8',
    );

    expect(helperSource).toContain('presetSearchIndexCache');
    expect(helperSource).toContain('getPresetSearchIndex(entry)');
    expect(helperSource).not.toContain(
      'const haystack = [entry.title, entry.author, entry.id, ...(entry.tags ?? [])]',
    );
  });

  test('updates GPU VM state in place after dispatch instead of spreading every frame', () => {
    const vmSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'milkdrop', 'vm.ts'),
      'utf8',
    );

    expect(vmSource).toContain('Object.assign(this.state, result.state)');
    expect(vmSource).not.toContain(
      'this.state = { ...this.state, ...result.state };',
    );
  });

  test('reuses the MilkDrop frame variables proxy across frames', () => {
    const vmSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'milkdrop', 'vm.ts'),
      'utf8',
    );

    expect(vmSource).toContain('private readonly variablesProxy = new Proxy');
    expect(vmSource).toContain('this.frameVariablesSnapshot = null');
    expect(vmSource).not.toContain(
      'const variablesProxy = new Proxy({} as Record<string, number>, {',
    );
  });

  test('binds MilkDrop VM frame callbacks once per VM instead of once per frame', () => {
    const vmSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'milkdrop', 'vm.ts'),
      'utf8',
    );
    const buildFrameSource = vmSource.slice(
      vmSource.indexOf('private buildFrame('),
      vmSource.indexOf('\n  }\n}\n\nexport function createMilkdropVM'),
    );

    expect(buildFrameSource).not.toContain('.bind(this)');
    expect(vmSource).toContain(
      'private readonly frameCallbacks = this.createFrameCallbacks();',
    );
  });

  test('updates audio-reactive decoration without rerendering static React shells', () => {
    const stageControlsSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'StageControls.tsx',
      ),
      'utf8',
    );
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(stageControlsSource).not.toContain('useAudioEnergy');
    expect(appSource).not.toContain('useAudioEnergy');
    expect(stageControlsSource).toContain('subscribeAudioEnergy');
    expect(appSource).toContain('subscribeAudioEnergy');
  });

  test('keeps deferred payloads out of shell precache and uses content-stable build names', () => {
    const serviceWorkerSource = readFileSync(
      join(import.meta.dir, '..', '..', 'public', 'service-worker.js'),
      'utf8',
    );
    const viteSource = readFileSync(
      join(import.meta.dir, '..', '..', 'vite.config.js'),
      'utf8',
    );
    const indexSource = readFileSync(
      join(import.meta.dir, '..', '..', 'index.html'),
      'utf8',
    );
    const tokensSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'tokens.css'),
      'utf8',
    );

    const shellAssetsSource = serviceWorkerSource.slice(
      serviceWorkerSource.indexOf('const CORE_SHELL_ASSETS'),
      serviceWorkerSource.indexOf("self.addEventListener('install'"),
    );
    expect(shellAssetsSource).not.toContain('/milkdrop-presets/catalog.json');
    expect(serviceWorkerSource).toContain(
      'await cache.addAll(CORE_SHELL_ASSETS)',
    );
    expect(viteSource).not.toContain('Date.now()');
    expect(viteSource).not.toContain('buildId');
    expect(viteSource).toContain("chunkFileNames: 'assets/[name]-[hash].js'");
    expect(indexSource).not.toContain('/vendor/normalize.min.css');
    expect(tokensSource).toContain('@import "./normalize.css";');
  });

  test('does not mark mutable human-named public assets immutable', () => {
    const headersSource = readFileSync(
      join(import.meta.dir, '..', '..', 'public', '_headers'),
      'utf8',
    );

    expect(headersSource).toContain(
      'Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
    );
    expect(headersSource.match(/\bimmutable\b/gu)).toHaveLength(1);
  });

  test('avoids JSON serialization and repeated texture lookup in WebGPU feedback state updates', () => {
    const feedbackSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'milkdrop',
        'feedback-manager-webgpu-tsl.ts',
      ),
      'utf8',
    );

    expect(feedbackSource).toContain('buildCompositeStateKey(state)');
    expect(feedbackSource).not.toContain('JSON.stringify({');
    expect(feedbackSource).toContain('currentOverlayTextureName');
    expect(feedbackSource).toContain('currentWarpTextureName');
  });
});

describe('Service worker caching behavior', () => {
  test('does not activate an incomplete core shell', async () => {
    const worker = loadServiceWorker({
      add: (asset) =>
        asset === '/index.html'
          ? Promise.reject(new Error('missing core shell'))
          : Promise.resolve(),
    });
    const install = worker.handlers.get('install');
    expect(install).toBeDefined();
    if (!install) {
      throw new Error('Expected an install handler.');
    }
    let installWork: Promise<unknown> | undefined;
    install({
      waitUntil(work) {
        installWork = work;
      },
    });

    await expect(installWork).rejects.toThrow('missing core shell');
    expect(worker.skipWaitingCalls).toBe(0);
  });

  test('allows an optional preview miss without blocking activation', async () => {
    const worker = loadServiceWorker({
      add: (asset) =>
        asset.includes('/previews/')
          ? Promise.reject(new Error('missing optional preview'))
          : Promise.resolve(),
    });
    const install = worker.handlers.get('install');
    expect(install).toBeDefined();
    if (!install) {
      throw new Error('Expected an install handler.');
    }
    let installWork: Promise<unknown> | undefined;
    install({
      waitUntil(work) {
        installWork = work;
      },
    });

    await expect(installWork).resolves.toBeUndefined();
    expect(worker.skipWaitingCalls).toBe(1);
  });

  test('resolves the network response without blocking on the cache write, holding the write on waitUntil', async () => {
    let finishPut: (() => void) | undefined;
    const putWork = new Promise<void>((resolve) => {
      finishPut = resolve;
    });
    const worker = loadServiceWorker({
      fetch: () =>
        Promise.resolve(
          new Response('catalog', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      put: () => putWork,
    });
    const fetchHandler = worker.handlers.get('fetch');
    expect(fetchHandler).toBeDefined();
    if (!fetchHandler) {
      throw new Error('Expected a fetch handler.');
    }
    let responseWork: Promise<Response> | undefined;
    const extensions: Promise<unknown>[] = [];
    fetchHandler({
      request: {
        method: 'GET',
        mode: 'cors',
        url: 'https://toil.fyi/milkdrop-presets/catalog.json',
      },
      respondWith(response) {
        responseWork = response;
      },
      waitUntil(work) {
        extensions.push(work);
      },
    });

    // The response must not wait for the (still pending) cache write — the
    // write is handed to event.waitUntil, which keeps the worker alive
    // until it finishes without adding storage latency to the response.
    await expect(responseWork).resolves.toBeInstanceOf(Response);
    expect(extensions.length).toBeGreaterThan(0);

    finishPut?.();
    await Promise.all(extensions);
  });

  test('returns a successful network response when an optional runtime write fails', async () => {
    const worker = loadServiceWorker({
      fetch: () =>
        Promise.resolve(
          new Response('catalog', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      put: () => Promise.reject(new Error('cache quota exceeded')),
    });
    const fetchHandler = worker.handlers.get('fetch');
    if (!fetchHandler) {
      throw new Error('Expected a fetch handler.');
    }
    let responseWork: Promise<Response> | undefined;
    fetchHandler({
      request: {
        method: 'GET',
        mode: 'cors',
        url: 'https://toil.fyi/milkdrop-presets/catalog.json',
      },
      respondWith(response) {
        responseWork = response;
      },
    });

    const response = await responseWork;
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('catalog');
  });
});
