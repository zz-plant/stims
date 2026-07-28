import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneBlendState } from '../../src/js/milkdrop/runtime/session.ts';

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

  test('caches overlay browse filtering and uses video frame callbacks for captured video when available', () => {
    const browsePanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'milkdrop',
        'overlay',
        'browse-panel.ts',
      ),
      'utf8',
    );
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

    expect(browsePanelSource).toContain('lastFilteredPresetSignature');
    expect(browsePanelSource).toContain('lastFilteredPresets');
    expect(browsePanelSource).toContain(
      'if (filteredPresetSignature !== this.lastFilteredPresetSignature)',
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
    const sidePanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'SidePanel.tsx',
      ),
      'utf8',
    );

    expect(sidePanelSource).toContain('const catalogEntryById = useMemo');
    expect(sidePanelSource).toContain('catalogEntryById.get(r.presetId)');
    expect(sidePanelSource).not.toContain(
      'engine.catalog.find((e) => e.id === r.presetId)',
    );
    expect(browsePanelSource).toContain('const sorted = useMemo');
    expect(browsePanelSource).toContain(
      'sortEntries(browseEntries, sortMode, randomSeed)',
    );
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

  test('patches visible overlay preview rows without forcing a full browse render', () => {
    const browsePanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'milkdrop',
        'overlay',
        'browse-panel.ts',
      ),
      'utf8',
    );

    expect(browsePanelSource).toContain('patchVisiblePreviewRow');
    expect(browsePanelSource).toContain('replaceChild(nextRow, currentRow)');
    expect(browsePanelSource).not.toContain(
      'setPresetPreview(preview: MilkdropPresetRenderPreview) {\n    this.previewStates.set(preview.presetId, preview);\n    this.browseDirty = true;',
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
    const hudSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'AudioSpectrumHud.tsx',
      ),
      'utf8',
    );
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

    expect(hudSource).not.toContain('useAudioEnergy');
    expect(stageControlsSource).not.toContain('useAudioEnergy');
    expect(appSource).not.toContain('useAudioEnergy');
    expect(hudSource).toContain('subscribeAudioEnergy');
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
      serviceWorkerSource.indexOf('const SHELL_ASSETS'),
      serviceWorkerSource.indexOf("self.addEventListener('install'"),
    );
    expect(shellAssetsSource).not.toContain('/milkdrop-presets/catalog.json');
    expect(serviceWorkerSource).not.toContain('cache.addAll(SHELL_ASSETS)');
    expect(viteSource).not.toContain('Date.now()');
    expect(viteSource).not.toContain('buildId');
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
