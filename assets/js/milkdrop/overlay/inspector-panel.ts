import {
  describeMilkdropScenePickResult,
  getMilkdropSceneDragFieldUpdates,
  getMilkdropScenePickResult,
  getMilkdropSceneSelectionFieldMap,
  isMilkdropSceneSelectionEditable,
  type MilkdropScenePickResult,
  resolveMilkdropScenePointerPoint,
} from '../runtime/scene-selection.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropSupportStatus,
} from '../types';
import {
  compatibilityCategoryLabel,
  fidelityLabel,
  formatPrimaryCompatibilityMessage,
  getPrimaryDegradationReason,
  supportLabel,
} from './preset-row';

export type InspectorPanelCallbacks = {
  onInspectorFieldChange: (key: string, value: string | number) => void;
};

type InspectorMetric = {
  label: string;
  value: string;
};

export function formatCompatibilitySummary({
  support,
  compiled,
}: {
  support: { status: MilkdropSupportStatus; reasons: string[] };
  compiled: MilkdropCompiledPreset;
}) {
  const parity = compiled.ir.compatibility.parity;
  const primaryReason = getPrimaryDegradationReason(compiled);
  const degradationCategorySummary =
    parity.degradationReasons.length > 0
      ? [
          ...new Set(
            parity.degradationReasons.map((reason) =>
              compatibilityCategoryLabel(reason.category),
            ),
          ),
        ].join(', ')
      : 'None';
  const primaryNote =
    primaryReason || support.status !== 'supported'
      ? formatPrimaryCompatibilityMessage({ primaryReason, support })
      : (parity.visualFallbacks[0] ?? 'Validated for the active backend.');
  return { degradationCategorySummary, primaryNote };
}

export function formatInspectorMetrics({
  compiled,
  frameState,
  backend,
  presetEntry,
  selectedObjectLabel = 'None',
}: {
  compiled: MilkdropCompiledPreset;
  frameState: MilkdropFrameState;
  backend: 'webgl' | 'webgpu';
  presetEntry?: MilkdropCatalogEntry | null;
  selectedObjectLabel?: string;
}) {
  const support = compiled.ir.compatibility.backends[backend];
  const parity = compiled.ir.compatibility.parity;
  const semanticSupport = parity.semanticSupport ?? {
    fidelityClass: parity.fidelityClass,
    evidence: parity.evidence,
    visualEvidenceTier: parity.visualEvidenceTier,
  };
  const visualCertification = presetEntry?.visualCertification ??
    parity.visualCertification ?? {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass:
        parity.fidelityClass === 'exact' ||
        parity.fidelityClass === 'near-exact'
          ? 'partial'
          : parity.fidelityClass,
      visualEvidenceTier:
        parity.visualEvidenceTier === 'visual'
          ? 'runtime'
          : parity.visualEvidenceTier,
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['No measured WebGPU reference capture is recorded yet.'],
    };
  const compatibilitySummary = formatCompatibilitySummary({
    support,
    compiled,
  });
  return [
    { label: 'Backend', value: backend },
    { label: 'Transport support', value: supportLabel(support.status) },
    {
      label: 'Fidelity',
      value: fidelityLabel(
        presetEntry?.fidelityClass ?? visualCertification.fidelityClass,
      ),
    },
    {
      label: 'Semantic support',
      value: fidelityLabel(semanticSupport.fidelityClass),
    },
    {
      label: 'Visual certification',
      value: `${visualCertification.status} (${visualCertification.measured ? 'measured' : 'inferred'})`,
    },
    {
      label: 'Required backend',
      value: visualCertification.requiredBackend ?? 'none',
    },
    {
      label: 'Captured backend',
      value: visualCertification.actualBackend ?? 'none',
    },
    {
      label: 'Degradation categories',
      value: compatibilitySummary.degradationCategorySummary,
    },
    {
      label: 'Evidence',
      value: `compile ${semanticSupport.evidence.compile}, runtime ${semanticSupport.evidence.runtime}, visual ${presetEntry?.evidence.visual ?? parity.evidence.visual}`,
    },
    {
      label: 'Backend divergence',
      value: String(parity.backendDivergence.length),
    },
    { label: 'Visual fallbacks', value: String(parity.visualFallbacks.length) },
    {
      label: 'Features',
      value:
        compiled.ir.compatibility.featureAnalysis.featuresUsed.join(', ') ||
        'base-globals',
    },
    { label: 'Frame', value: String(frameState.signals.frame) },
    {
      label: 'Bass / mid / treb',
      value: `${frameState.signals.bass.toFixed(2)} / ${frameState.signals.mid.toFixed(2)} / ${frameState.signals.treb.toFixed(2)}`,
    },
    { label: 'Beat pulse', value: frameState.signals.beatPulse.toFixed(2) },
    { label: 'Selected object', value: selectedObjectLabel },
    {
      label: 'Main wave points',
      value: String(Math.floor(frameState.mainWave.positions.length / 3)),
    },
    { label: 'Custom waves', value: String(frameState.customWaves.length) },
    { label: 'Shapes', value: String(frameState.shapes.length) },
    { label: 'Borders', value: String(frameState.borders.length) },
    {
      label: 'Particle count',
      value: String(frameState.gpuGeometry?.particleField?.instanceCount ?? 0),
    },
    {
      label: 'Register pressure',
      value: `q${compiled.ir.compatibility.featureAnalysis.registerUsage.q} / t${compiled.ir.compatibility.featureAnalysis.registerUsage.t}`,
    },
    {
      label: 'Certification note',
      value:
        visualCertification.reasons[0] ??
        (visualCertification.status === 'certified'
          ? 'Measured WebGPU reference capture passed.'
          : 'Awaiting measured WebGPU certification.'),
    },
    { label: 'Primary note', value: compatibilitySummary.primaryNote },
  ] satisfies InspectorMetric[];
}

function buildMetricNode(metric: InspectorMetric) {
  const row = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = `${metric.label}:`;
  row.append(strong, document.createTextNode(` ${metric.value}`));
  return row;
}

export class InspectorPanel {
  readonly element: HTMLElement;
  readonly selectionElement: HTMLElement;
  readonly metricsElement: HTMLElement;

  private readonly callbacks: InspectorPanelCallbacks;
  private readonly controlsElement: HTMLElement;
  private visible = false;
  private lastCompiledPreset: MilkdropCompiledPreset | null = null;
  private lastFrameState: MilkdropFrameState | null = null;
  private currentSelection: MilkdropScenePickResult | null = null;
  private dragState: {
    pointerId: number;
    selection: MilkdropScenePickResult;
    startPoint: { worldX: number; worldY: number };
    baseFields: Record<string, number>;
  } | null = null;
  private lastControlsSignature = '';
  private lastMetricsSignature = '';
  private lastMetricsRenderAt = 0;
  private readonly pointerDownListener = (event: PointerEvent) =>
    this.handlePointerDown(event);
  private readonly pointerMoveListener = (event: PointerEvent) =>
    this.handlePointerMove(event);
  private readonly pointerUpListener = (event: PointerEvent) =>
    this.handlePointerUp(event);
  private readonly pointerCancelListener = (event: PointerEvent) =>
    this.handlePointerUp(event);

  constructor(callbacks: InspectorPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('section');
    this.element.className = 'milkdrop-overlay__tab-panel';

    this.selectionElement = document.createElement('div');
    this.selectionElement.className = 'milkdrop-overlay__inspector-selection';

    this.controlsElement = document.createElement('div');
    this.controlsElement.className = 'milkdrop-overlay__inspector-controls';
    this.metricsElement = document.createElement('div');
    this.metricsElement.className = 'milkdrop-overlay__inspector-metrics';
    this.element.append(
      this.selectionElement,
      this.controlsElement,
      this.metricsElement,
    );

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.pointerDownListener, true);
      window.addEventListener('pointermove', this.pointerMoveListener, true);
      window.addEventListener('pointerup', this.pointerUpListener, true);
      window.addEventListener(
        'pointercancel',
        this.pointerCancelListener,
        true,
      );
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.element.hidden = !visible;
    this.syncSceneSelectionSummary();
  }

  shouldRenderMetrics(isOpen: boolean) {
    return isOpen && this.visible;
  }

  setCompiledPreset(compiled: MilkdropCompiledPreset) {
    this.lastCompiledPreset = compiled;
    const signature = `${compiled.source.id}:${compiled.formattedSource}`;
    if (signature === this.lastControlsSignature) {
      this.syncSceneSelectionSummary();
      return;
    }
    this.lastControlsSignature = signature;

    const fields: HTMLElement[] = [
      this.buildInspectorField('title', 'Title', compiled.title),
      this.buildInspectorField('author', 'Author', compiled.author ?? ''),
      this.buildInspectorField('zoom', 'Zoom', compiled.ir.numericFields.zoom, {
        min: 0.75,
        max: 1.4,
        step: 0.01,
      }),
      this.buildInspectorField(
        'rot',
        'Rotation',
        compiled.ir.numericFields.rot,
        {
          min: -0.2,
          max: 0.2,
          step: 0.0025,
        },
      ),
      this.buildInspectorField('warp', 'Warp', compiled.ir.numericFields.warp, {
        min: 0,
        max: 0.45,
        step: 0.005,
      }),
      this.buildInspectorField(
        'blend_duration',
        'Blend seconds',
        compiled.ir.numericFields.blend_duration,
        { min: 0, max: 8, step: 0.25 },
      ),
      this.buildInspectorField(
        'mesh_density',
        'Mesh density',
        compiled.ir.numericFields.mesh_density,
        { min: 8, max: 36, step: 1 },
      ),
      this.buildInspectorField(
        'wave_scale',
        'Main wave scale',
        compiled.ir.numericFields.wave_scale,
        { min: 0.5, max: 2, step: 0.01 },
      ),
      this.buildInspectorField(
        'ob_size',
        'Outer border',
        compiled.ir.numericFields.ob_size,
        { min: 0, max: 0.3, step: 0.005 },
      ),
      this.buildInspectorField(
        'ib_size',
        'Inner border',
        compiled.ir.numericFields.ib_size,
        { min: 0, max: 0.3, step: 0.005 },
      ),
    ];

    compiled.ir.customWaves.forEach((wave) => {
      fields.push(
        this.buildInspectorField(
          `wavecode_${wave.index - 1}_enabled`,
          `Wave ${wave.index} enabled`,
          wave.fields.enabled ?? 0,
          { min: 0, max: 1, step: 1 },
        ),
      );
      fields.push(
        this.buildInspectorField(
          `wavecode_${wave.index - 1}_samples`,
          `Wave ${wave.index} samples`,
          wave.fields.samples ?? 64,
          { min: 8, max: 192, step: 1 },
        ),
      );
    });

    compiled.ir.customShapes.forEach((shape) => {
      fields.push(
        this.buildInspectorField(
          `shapecode_${shape.index - 1}_enabled`,
          `Shape ${shape.index} enabled`,
          shape.fields.enabled ?? 0,
          { min: 0, max: 1, step: 1 },
        ),
      );
      fields.push(
        this.buildInspectorField(
          `shapecode_${shape.index - 1}_rad`,
          `Shape ${shape.index} radius`,
          shape.fields.rad ?? 0.15,
          { min: 0.04, max: 0.8, step: 0.01 },
        ),
      );
    });

    this.controlsElement.replaceChildren(...fields);
    this.syncSceneSelectionSummary();
  }

  renderMetrics({
    compiled,
    frameState,
    backend,
    presetEntry,
    isOpen,
  }: {
    compiled: MilkdropCompiledPreset | null;
    frameState: MilkdropFrameState | null;
    backend: 'webgl' | 'webgpu';
    presetEntry?: MilkdropCatalogEntry | null;
    isOpen: boolean;
  }) {
    this.lastCompiledPreset = compiled;
    this.lastFrameState = frameState;

    if (!frameState || !compiled) {
      if (this.shouldRenderMetrics(isOpen)) {
        this.metricsElement.textContent = 'Waiting for preview frames...';
      }
      this.syncSceneSelectionSummary();
      return;
    }

    if (!this.shouldRenderMetrics(isOpen)) {
      this.syncSceneSelectionSummary();
      return;
    }

    const metrics = formatInspectorMetrics({
      compiled,
      frameState,
      backend,
      presetEntry,
      selectedObjectLabel: describeMilkdropScenePickResult(
        this.currentSelection,
      ).title,
    });
    const metricsSignature = metrics
      .map((metric) => `${metric.label}:${metric.value}`)
      .join('|');
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      metricsSignature === this.lastMetricsSignature &&
      now - this.lastMetricsRenderAt < 240
    ) {
      this.syncSceneSelectionSummary();
      return;
    }
    this.lastMetricsSignature = metricsSignature;
    this.lastMetricsRenderAt = now;
    this.metricsElement.replaceChildren(...metrics.map(buildMetricNode));
    this.syncSceneSelectionSummary();
  }

  setSceneSelection(selection: MilkdropScenePickResult | null) {
    this.currentSelection = selection;
    if (!selection || !isMilkdropSceneSelectionEditable(selection)) {
      this.dragState = null;
    }
    this.syncSceneSelectionSummary();
  }

  getSceneSelection() {
    return this.currentSelection;
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.pointerDownListener, true);
      window.removeEventListener('pointermove', this.pointerMoveListener, true);
      window.removeEventListener('pointerup', this.pointerUpListener, true);
      window.removeEventListener(
        'pointercancel',
        this.pointerCancelListener,
        true,
      );
    }
  }

  private buildInspectorField(
    key: string,
    label: string,
    value: string | number,
    options: { min?: number; max?: number; step?: number } = {},
  ) {
    const wrap = document.createElement('label');
    wrap.className = 'milkdrop-overlay__field';
    const title = document.createElement('span');
    title.textContent = label;
    wrap.appendChild(title);

    if (typeof value === 'number') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(options.min ?? 0);
      input.max = String(options.max ?? 2);
      input.step = String(options.step ?? 0.01);
      input.value = String(value);
      const valueLabel = document.createElement('strong');
      valueLabel.textContent = Number(value).toFixed(2);
      input.addEventListener('input', () => {
        const nextValue = Number.parseFloat(input.value);
        valueLabel.textContent = nextValue.toFixed(2);
        this.callbacks.onInspectorFieldChange(key, nextValue);
      });
      wrap.append(input, valueLabel);
      return wrap;
    }

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = value;
    textInput.addEventListener('change', () => {
      this.callbacks.onInspectorFieldChange(key, textInput.value);
    });
    wrap.appendChild(textInput);
    return wrap;
  }

  private isSceneInteractionActive() {
    if (!this.visible || typeof document === 'undefined') {
      return false;
    }

    return Boolean(document.querySelector('.milkdrop-overlay.is-open'));
  }

  private getPointerPoint(event: PointerEvent) {
    return resolveMilkdropScenePointerPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }

  private isEventInsideOverlayPanel(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest('.milkdrop-overlay__panel'))
    );
  }

  private getDragFieldMap(selection: MilkdropScenePickResult) {
    const compiled = this.lastCompiledPreset;
    if (!compiled) {
      return {};
    }

    return getMilkdropSceneSelectionFieldMap(compiled, selection);
  }

  private syncSceneSelectionSummary() {
    const description = describeMilkdropScenePickResult(this.currentSelection);

    const title = document.createElement('strong');
    title.textContent = description.title;
    title.className = 'milkdrop-overlay__inspector-selection-title';

    const detail = document.createElement('div');
    detail.textContent = description.detail;
    detail.className = 'milkdrop-overlay__inspector-selection-detail';

    const fieldSummary = document.createElement('div');
    fieldSummary.textContent =
      this.currentSelection?.sourceFields.join(', ') ||
      description.fieldSummary;
    fieldSummary.className = 'milkdrop-overlay__inspector-selection-fields';

    this.selectionElement.dataset.selectionKind =
      this.currentSelection?.kind ?? 'none';
    this.selectionElement.replaceChildren(title, detail, fieldSummary);
  }

  private handlePointerDown(event: PointerEvent) {
    if (event.button !== 0 || !this.isSceneInteractionActive()) {
      return;
    }

    if (this.isEventInsideOverlayPanel(event.target)) {
      return;
    }

    const compiled = this.lastCompiledPreset;
    const frameState = this.lastFrameState;
    if (!compiled || !frameState) {
      return;
    }

    const point = this.getPointerPoint(event);
    const selection = getMilkdropScenePickResult({
      frameState,
      point,
    });
    this.setSceneSelection(selection);
    if (!selection) {
      return;
    }

    event.preventDefault();

    if (!isMilkdropSceneSelectionEditable(selection)) {
      return;
    }

    this.dragState = {
      pointerId: event.pointerId,
      selection,
      startPoint: point,
      baseFields: this.getDragFieldMap(selection),
    };
  }

  private handlePointerMove(event: PointerEvent) {
    if (
      !this.dragState ||
      event.pointerId !== this.dragState.pointerId ||
      !this.isSceneInteractionActive()
    ) {
      return;
    }

    const compiled = this.lastCompiledPreset;
    if (!compiled) {
      return;
    }

    const currentPoint = this.getPointerPoint(event);
    const updates = getMilkdropSceneDragFieldUpdates({
      compiled,
      selection: this.dragState.selection,
      currentPoint,
      startPoint: this.dragState.startPoint,
      baseFields: this.dragState.baseFields,
      modifiers: {
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
    });

    const entries = Object.entries(updates);
    if (entries.length === 0) {
      return;
    }

    event.preventDefault();
    entries.forEach(([key, value]) => {
      this.callbacks.onInspectorFieldChange(key, value);
    });
  }

  private handlePointerUp(event: PointerEvent) {
    if (this.dragState && event.pointerId === this.dragState.pointerId) {
      this.dragState = null;
    }
  }
}
