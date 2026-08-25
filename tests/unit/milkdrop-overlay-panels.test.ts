import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import {
  fidelityTierBadgeClass,
  fidelityTierLabel,
  formatMeasuredMismatchPercent,
  getPresetCertificationBadgeStatus,
  getPresetMetaQualifier,
} from '../../src/js/milkdrop/overlay/preset-row.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropEditorSessionState,
} from '../../src/js/milkdrop/types.ts';

function createCatalogEntry(id: string, title: string): MilkdropCatalogEntry {
  return {
    id,
    title,
    author: 'Stims',
    origin: 'bundled',
    featuresUsed: [],
    warnings: [],
    rating: 0,
    isFavorite: false,
    tags: [],
    supports: {
      webgl: {
        status: 'supported',
        reasons: [],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
      },
      webgpu: {
        status: 'supported',
        reasons: [],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
      },
    },
    fidelityClass: 'exact',
    visualEvidenceTier: 'none',
    fidelityTier: 'semantic-only',
    semanticSupport: {
      fidelityClass: 'exact',
      evidence: {
        compile: 'verified',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
    },
    visualCertification: {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'partial',
      visualEvidenceTier: 'none',
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['No measured WebGPU reference capture is recorded yet.'],
    },
    evidence: {
      compile: 'verified',
      runtime: 'not-run',
      visual: 'not-captured',
    },
    certification: 'bundled',
    corpusTier: 'bundled',
    parity: {
      ignoredFields: [],
      approximatedShaderLines: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [],
      fidelityClass: 'exact',
      evidence: {
        compile: 'verified',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
      semanticSupport: {
        fidelityClass: 'exact',
        evidence: {
          compile: 'verified',
          runtime: 'not-run',
          visual: 'not-captured',
        },
        visualEvidenceTier: 'none',
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'partial',
        visualEvidenceTier: 'none',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    },
  } as MilkdropCatalogEntry;
}

describe('editor panel change propagation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // The editor debounce is 120ms; poll instead of sleeping a fixed 250ms so
  // the happy path resolves as soon as the debounce fires.
  async function waitForCalls(
    fn: ReturnType<typeof mock>,
    count: number,
    timeoutMs = 2000,
  ) {
    const start = performance.now();
    while (fn.mock.calls.length < count) {
      if (performance.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${count} call(s); saw ${fn.mock.calls.length}.`,
        );
      }
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
  }

  function createEditorPanelHarness() {
    const OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const onEditorSourceChange = mock();
    const panel = new EditorPanel({
      onEditorSourceChange,
      onRevertToActive: mock(),
      onDuplicatePreset: mock(),
      onExport: mock(),
      onDeletePreset: mock(),
      onRequestImport: mock(),
    });
    document.body.appendChild(panel.element);

    const state: MilkdropEditorSessionState = {
      source: 'zoom=1\n',
      latestCompiled: null,
      activeCompiled: null,
      diagnostics: [],
      dirty: false,
    };
    panel.setSessionState(state);
    return {
      panel,
      state,
      onEditorSourceChange,
      restore() {
        panel.dispose();
        globalThis.MutationObserver = OriginalMutationObserver;
      },
    };
  }

  test('debounces editor changes before reporting source updates', async () => {
    const harness = createEditorPanelHarness();
    const snippetButton = document.querySelector(
      '.stims-editor__insert[data-insert="Pulse zoom"]',
    ) as HTMLButtonElement | null;
    if (!snippetButton) {
      throw new Error('Expected a snippet button to exist.');
    }

    snippetButton.click();
    expect(harness.onEditorSourceChange).not.toHaveBeenCalled();

    await waitForCalls(harness.onEditorSourceChange, 1);

    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);
    expect(harness.onEditorSourceChange.mock.calls[0]?.[0]).toContain(
      'zoom=1.01',
    );

    harness.restore();
  });

  test('update now flushes the current draft immediately and clears the debounce', async () => {
    const harness = createEditorPanelHarness();

    const snippetButton = document.querySelector(
      '.stims-editor__insert[data-insert="Pulse zoom"]',
    ) as HTMLButtonElement | null;
    const applyButton = document.querySelector(
      '.stims-editor__btn[data-action="apply"]',
    ) as HTMLButtonElement | null;
    if (!snippetButton || !applyButton) {
      throw new Error('Expected the editor controls to exist.');
    }

    snippetButton.click();
    expect(harness.onEditorSourceChange).not.toHaveBeenCalled();

    applyButton.click();
    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);

    // Outlast the 120ms debounce to prove the flush cleared it.
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);

    harness.restore();
  });

  test('keeps newer buffered typing visible when an older applied state arrives', async () => {
    const harness = createEditorPanelHarness();

    const snippetButton = document.querySelector(
      '.stims-editor__insert[data-insert="Pulse zoom"]',
    ) as HTMLButtonElement | null;
    if (!snippetButton) {
      throw new Error('Expected a snippet button to exist.');
    }

    snippetButton.click();
    harness.panel.setSessionState(harness.state);

    const editorText = document.querySelector(
      '.cm-content',
    ) as HTMLElement | null;
    expect(editorText?.textContent).toContain('zoom=1.01');

    await waitForCalls(harness.onEditorSourceChange, 1);
    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);
    expect(harness.onEditorSourceChange.mock.calls[0]?.[0]).toContain(
      'zoom=1.01',
    );

    harness.restore();
  });
});

describe('preset row parity badges', () => {
  test('prefers familiar collection labels over raw effect tags in row metadata', () => {
    const preset = createCatalogEntry('parallel-universe', 'Parallel Universe');
    preset.tags = [
      'collection:classic-milkdrop',
      'collection:cream-of-the-crop',
      'lasers',
    ];

    expect(getPresetMetaQualifier(preset)).toBe('Cream of the Crop');
  });

  test('uses the shipped Rovastar collection label ahead of generic classic tags', () => {
    const preset = createCatalogEntry('glowsticks', 'Glowsticks');
    preset.tags = [
      'collection:classic-milkdrop',
      'collection:rovastar-and-collaborators',
      'glowsticks',
    ];

    expect(getPresetMetaQualifier(preset)).toBe('Rovastar and collaborators');
  });

  test('formats measured mismatch ratios as compact percent strings', () => {
    expect(formatMeasuredMismatchPercent(null)).toBeNull();
    expect(formatMeasuredMismatchPercent(undefined)).toBeNull();
    expect(formatMeasuredMismatchPercent(Number.NaN)).toBeNull();
    expect(formatMeasuredMismatchPercent(0)).toBe('0%');
    expect(formatMeasuredMismatchPercent(0.0001)).toBe('<1%');
    expect(formatMeasuredMismatchPercent(0.234)).toBe('23%');
    expect(formatMeasuredMismatchPercent(0.999)).toBe('100%');
    expect(formatMeasuredMismatchPercent(2)).toBe('100%');
    expect(formatMeasuredMismatchPercent(-1)).toBe('0%');
  });

  test('returns no badge status for inferred-only presets', () => {
    const preset = createCatalogEntry('inferred', 'Inferred');
    expect(getPresetCertificationBadgeStatus(preset)).toBeNull();
  });

  test('marks measured-and-certified presets as verified', () => {
    const preset = createCatalogEntry('verified', 'Verified');
    preset.visualCertification = {
      ...preset.visualCertification,
      measured: true,
      status: 'certified',
      source: 'reference-suite',
      mismatchRatio: 0.005,
      failThreshold: 0.02,
    };
    expect(getPresetCertificationBadgeStatus(preset)).toBe('certified');
  });

  test('marks measured-but-failing presets as drift', () => {
    const preset = createCatalogEntry('drift', 'Drift');
    preset.visualCertification = {
      ...preset.visualCertification,
      measured: true,
      status: 'uncertified',
      source: 'reference-suite',
      mismatchRatio: 0.55,
      failThreshold: 0.02,
    };
    expect(getPresetCertificationBadgeStatus(preset)).toBe('uncertified');
  });

  test('fidelity tier label and badge class for measured-visual presets', () => {
    expect(fidelityTierLabel('measured-visual')).toBe('Certified');
    expect(fidelityTierBadgeClass('measured-visual')).toBe(
      'milkdrop-overlay__preset-tag--verified',
    );
  });

  test('fidelity tier label and badge class for measured-checksum presets', () => {
    expect(fidelityTierLabel('measured-checksum')).toBe('Baseline');
    expect(fidelityTierBadgeClass('measured-checksum')).toBe(
      'milkdrop-overlay__preset-tag--baseline',
    );
  });

  test('fidelity tier label and badge class for semantic-only presets', () => {
    expect(fidelityTierLabel('semantic-only')).toBe('Semantic');
    expect(fidelityTierBadgeClass('semantic-only')).toBe(
      'milkdrop-overlay__preset-tag--semantic',
    );
  });
});
