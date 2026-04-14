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

    expect(shellHookSource).toContain(': runtimeCatalogReady');
    expect(shellHookSource).toContain('? runtimeCatalog');
    expect(shellHookSource).toContain(': fallbackCatalog;');
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
    if (!blendState || blendState.mode !== 'gpu') {
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
});
