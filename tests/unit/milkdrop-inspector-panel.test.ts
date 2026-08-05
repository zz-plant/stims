import { describe, expect, test } from 'bun:test';
import { InspectorPanel } from '../../src/js/milkdrop/overlay/inspector-panel.ts';

describe('milkdrop inspector panel selection summary', () => {
  test('shows the current scene selection and editing hints', () => {
    const panel = new InspectorPanel({
      onInspectorFieldChange: () => {},
    });

    panel.setVisible(true);
    panel.setSceneSelection({
      kind: 'shape',
      slotIndex: 1,
      worldX: 0.1,
      worldY: 0.2,
      sourceFields: ['shape_1_x', 'shape_1_y', 'shape_1_rad', 'shape_1_ang'],
    });

    expect(panel.element.textContent ?? '').toContain('Shape 1');
    expect(panel.element.textContent ?? '').toContain('Drag to move');
    expect(panel.element.textContent ?? '').toContain('shape_1_x');

    panel.dispose();
  });

  test('formats measured drift metric accurately', () => {
    const {
      formatInspectorMetrics,
    } = require('../../src/js/milkdrop/overlay/inspector-panel.ts');
    const mockCompiled = {
      ir: {
        compatibility: {
          backends: {
            webgl: { status: 'supported', reasons: [] },
            webgpu: { status: 'supported', reasons: [] },
          },
          parity: {
            fidelityClass: 'exact',
            evidence: {
              compile: 'verified',
              runtime: 'smoke-tested',
              visual: 'reference-suite',
            },
            visualEvidenceTier: 'visual',
            backendDivergence: [],
            visualFallbacks: [],
            degradationReasons: [],
            featureAnalysis: {
              featuresUsed: ['base-globals'],
              registerUsage: { q: 0, t: 0 },
            },
          },
        },
      },
    };
    const mockFrameState = {
      signals: { frame: 1, bass: 1, mid: 1, treb: 1, beatPulse: 0 },
      mainWave: { positions: new Float32Array() },
      customWaves: [],
      shapes: [],
      borders: [],
    };
    const mockPresetEntry = {
      fidelityTier: 'measured-visual',
      fidelityClass: 'exact',
      evidence: { visual: 'reference-suite' },
      visualCertification: {
        status: 'certified',
        measured: true,
        fidelityClass: 'exact',
        mismatchRatio: 0.035,
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        reasons: ['Passed visual tolerance.'],
      },
    };

    const metrics = formatInspectorMetrics({
      compiled: mockCompiled,
      frameState: mockFrameState,
      backend: 'webgpu',
      presetEntry: mockPresetEntry,
    });

    const driftMetric = metrics.find(
      (m: { label: string; value: string }) => m.label === 'Measured drift',
    );
    expect(driftMetric).toBeDefined();
    expect(driftMetric?.value).toBe('4%');
  });
});
