import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneBlendState } from '../assets/js/milkdrop/runtime/session.ts';

describe('Workspace performance regressions', () => {
  test('keeps the root shell on the fallback catalog until the runtime is mounted', () => {
    const shellHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
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
        'assets',
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
        'assets',
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
      join(import.meta.dir, '..', 'assets', 'js', 'app.ts'),
      'utf8',
    );
    const catalogHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
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
        'assets',
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
        'assets',
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
        'assets',
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
        'assets',
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
        'assets',
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
        'assets',
        'js',
        'frontend',
        'BrowseSheetPanel.tsx',
      ),
      'utf8',
    );

    expect(browsePanelSource).toContain('const catalogEntryById = useMemo');
    expect(browsePanelSource).toContain('catalogEntryById.get(r.presetId)');
    expect(browsePanelSource).not.toContain(
      'const entry = catalog.find(\n                    (preset) => preset.id === r.presetId,\n                  );',
    );
    expect(browsePanelSource).toContain('const sortedBrowseEntries = useMemo');
    expect(browsePanelSource).toContain(
      'sortPresetEntries(browseEntries, sortMode, randomSeed)',
    );
  });

  test('caches frontend preset search indexes instead of rebuilding haystacks per match', () => {
    const helperSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
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
        'assets',
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
      join(import.meta.dir, '..', 'assets', 'js', 'milkdrop', 'vm.ts'),
      'utf8',
    );

    expect(vmSource).toContain('Object.assign(this.state, result.state)');
    expect(vmSource).not.toContain(
      'this.state = { ...this.state, ...result.state };',
    );
  });

  test('reuses the MilkDrop frame variables proxy across frames', () => {
    const vmSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'milkdrop', 'vm.ts'),
      'utf8',
    );

    expect(vmSource).toContain('private readonly variablesProxy = new Proxy');
    expect(vmSource).toContain('this.frameVariablesSnapshot = null');
    expect(vmSource).not.toContain(
      'const variablesProxy = new Proxy({} as Record<string, number>, {',
    );
  });

  test('avoids JSON serialization and repeated texture lookup in WebGPU feedback state updates', () => {
    const feedbackSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
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
