import type {
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
}: {
  compiled: MilkdropCompiledPreset;
  frameState: MilkdropFrameState;
  backend: 'webgl' | 'webgpu';
}) {
  const support = compiled.ir.compatibility.backends[backend];
  const parity = compiled.ir.compatibility.parity;
  const compatibilitySummary = formatCompatibilitySummary({
    support,
    compiled,
  });
  return [
    { label: 'Backend', value: backend },
    { label: 'Transport support', value: supportLabel(support.status) },
    { label: 'Fidelity', value: fidelityLabel(parity.fidelityClass) },
    {
      label: 'Certification',
      value: compiled.source.origin === 'bundled' ? 'bundled' : 'exploratory',
    },
    {
      label: 'Degradation categories',
      value: compatibilitySummary.degradationCategorySummary,
    },
    {
      label: 'Evidence',
      value: `compile ${parity.evidence.compile}, runtime ${parity.evidence.runtime}, visual ${parity.evidence.visual}`,
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
    {
      label: 'Main wave points',
      value: String(Math.floor(frameState.mainWave.positions.length / 3)),
    },
    { label: 'Custom waves', value: String(frameState.customWaves.length) },
    { label: 'Shapes', value: String(frameState.shapes.length) },
    { label: 'Borders', value: String(frameState.borders.length) },
    {
      label: 'Register pressure',
      value: `q${compiled.ir.compatibility.featureAnalysis.registerUsage.q} / t${compiled.ir.compatibility.featureAnalysis.registerUsage.t}`,
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
  readonly metricsElement: HTMLElement;

  private readonly callbacks: InspectorPanelCallbacks;
  private readonly controlsElement: HTMLElement;
  private visible = false;
  private lastControlsSignature = '';
  private lastMetricsSignature = '';
  private lastMetricsRenderAt = 0;

  constructor(callbacks: InspectorPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('section');
    this.element.className = 'milkdrop-overlay__tab-panel';

    this.controlsElement = document.createElement('div');
    this.controlsElement.className = 'milkdrop-overlay__inspector-controls';
    this.metricsElement = document.createElement('div');
    this.metricsElement.className = 'milkdrop-overlay__inspector-metrics';
    this.element.append(this.controlsElement, this.metricsElement);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.element.hidden = !visible;
  }

  shouldRenderMetrics(isOpen: boolean) {
    return isOpen && this.visible;
  }

  setCompiledPreset(compiled: MilkdropCompiledPreset) {
    const signature = `${compiled.source.id}:${compiled.formattedSource}`;
    if (signature === this.lastControlsSignature) {
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
  }

  renderMetrics({
    compiled,
    frameState,
    backend,
    isOpen,
  }: {
    compiled: MilkdropCompiledPreset | null;
    frameState: MilkdropFrameState | null;
    backend: 'webgl' | 'webgpu';
    isOpen: boolean;
  }) {
    if (!frameState || !compiled) {
      if (this.shouldRenderMetrics(isOpen)) {
        this.metricsElement.textContent = 'Waiting for preview frames...';
      }
      return;
    }

    if (!this.shouldRenderMetrics(isOpen)) {
      return;
    }

    const metrics = formatInspectorMetrics({ compiled, frameState, backend });
    const metricsSignature = metrics
      .map((metric) => `${metric.label}:${metric.value}`)
      .join('|');
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      metricsSignature === this.lastMetricsSignature &&
      now - this.lastMetricsRenderAt < 240
    ) {
      return;
    }
    this.lastMetricsSignature = metricsSignature;
    this.lastMetricsRenderAt = now;
    this.metricsElement.replaceChildren(...metrics.map(buildMetricNode));
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
}
