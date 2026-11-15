/**
 * Click-to-Demystify canvas inspector (#1680).
 *
 * Passive at runtime: no work during playback. On a click while inspect mode
 * is active, the clicked pixel is converted to normalized MilkDrop mesh
 * coordinates and the preset's dataflow is consulted to name the per-pixel
 * controls that drive that spot and the audio signals behind them. A small
 * floating card renders the result; Escape or a click elsewhere dismisses it.
 */

import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  analyzePresetDataflow,
  type PresetDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';

export type InspectCoords = {
  /** Normalized 0..1, left-to-right. */
  u: number;
  /** Normalized 0..1, top-to-bottom. */
  v: number;
  /** Centered -1..1, MilkDrop mesh x. */
  x: number;
  /** Centered -1..1, MilkDrop mesh y (y up). */
  y: number;
  rad: number;
  ang: number;
};

export type DrivingControl = {
  name: string;
  audio: string[];
};

export type InspectResult = {
  coords: InspectCoords;
  controls: DrivingControl[];
};

const INSPECTOR_CLASS = 'stims-canvas-inspector';

export function pixelToCoords(
  px: number,
  py: number,
  width: number,
  height: number,
): InspectCoords {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const u = Math.min(1, Math.max(0, px / w));
  const v = Math.min(1, Math.max(0, py / h));
  // MilkDrop mesh coords: x/y in [-1,1], y up, aspect-corrected by the
  // engine. We approximate with a square mapping here; the engine's own
  // aspect correction is applied to the mesh, not to this display value.
  const x = u * 2 - 1;
  const y = 1 - v * 2;
  const rad = Math.hypot(x, y);
  const ang = Math.atan2(y, x);
  return { u, v, x, y, rad, ang };
}

export function drivingControls(
  dataflow: PresetDataflow | null,
): DrivingControl[] {
  if (!dataflow) return [];
  const out: DrivingControl[] = [];
  const ppo = dataflow.drawnAudio.perPixelOutputs;
  if (ppo && ppo.size > 0) {
    for (const [name, audio] of ppo) {
      out.push({ name, audio: [...audio] });
    }
  } else {
    for (const name of dataflow.drawnAudio.perPixel) {
      out.push({ name, audio: [] });
    }
  }
  return out;
}

export function buildInspectResult(
  px: number,
  py: number,
  width: number,
  height: number,
  dataflow: PresetDataflow | null,
): InspectResult {
  return {
    coords: pixelToCoords(px, py, width, height),
    controls: drivingControls(dataflow),
  };
}

class CanvasInspector {
  readonly element: HTMLElement;
  private readonly card: HTMLElement;
  private dataflow: PresetDataflow | null = null;
  private onEditCode: ((control: string) => void) | null = null;
  private onScale: ((control: string, value: number) => void) | null = null;
  private dismissHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private attachedCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = INSPECTOR_CLASS;
    this.element.style.position = 'absolute';
    this.element.style.pointerEvents = 'none';
    this.element.style.zIndex = 'var(--z-overlay)';

    this.card = document.createElement('div');
    this.card.className = 'stims-canvas-inspector__card';
    this.card.style.pointerEvents = 'auto';
    this.card.style.display = 'none';
    this.element.appendChild(this.card);
  }

  attach(
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    dataflow: PresetDataflow | null,
    onEditCode?: (control: string) => void,
    onScale?: (control: string, value: number) => void,
  ) {
    this.dataflow = dataflow;
    this.onEditCode = onEditCode ?? null;
    this.onScale = onScale ?? null;
    this.attachedCanvas = canvas;
    stage.appendChild(this.element);

    this.clickHandler = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const result = buildInspectResult(
        px,
        py,
        rect.width,
        rect.height,
        this.dataflow,
      );
      this.renderCard(
        result,
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
      );
    };
    canvas.addEventListener('click', this.clickHandler);

    this.dismissHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hideCard();
    };
    window.addEventListener('keydown', this.dismissHandler);
  }

  detach() {
    if (this.clickHandler && this.attachedCanvas) {
      this.attachedCanvas.removeEventListener('click', this.clickHandler);
    }
    this.clickHandler = null;
    if (this.dismissHandler)
      window.removeEventListener('keydown', this.dismissHandler);
    this.dismissHandler = null;
    this.element.remove();
    this.hideCard();
  }

  updateDataflow(dataflow: PresetDataflow | null) {
    this.dataflow = dataflow;
  }

  private hideCard() {
    this.card.style.display = 'none';
    this.card.innerHTML = '';
  }

  private renderCard(
    result: InspectResult,
    px: number,
    py: number,
    width: number,
    height: number,
  ) {
    const { coords, controls } = result;
    this.card.innerHTML = '';
    this.card.style.display = 'block';
    this.card.style.left = `${Math.min(px + 12, width - 260)}px`;
    this.card.style.top = `${Math.min(py + 12, height - 160)}px`;

    const title = document.createElement('div');
    title.className = 'stims-canvas-inspector__title';
    title.textContent = `u=${coords.u.toFixed(2)} v=${coords.v.toFixed(2)} · rad=${coords.rad.toFixed(2)}`;
    this.card.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'stims-canvas-inspector__controls';
    for (const c of controls) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'stims-canvas-inspector__name';
      name.textContent = c.name;
      li.appendChild(name);
      const audio = document.createElement('span');
      audio.className = 'stims-canvas-inspector__audio';
      audio.textContent = c.audio.length ? c.audio.join(', ') : 'clockwork';
      li.appendChild(audio);
      if (this.onScale) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '2';
        slider.step = '0.01';
        slider.value = '1';
        slider.setAttribute('aria-label', `Scale ${c.name}`);
        slider.addEventListener('input', () =>
          this.onScale?.(c.name, Number(slider.value)),
        );
        li.appendChild(slider);
      }
      if (this.onEditCode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Edit code';
        btn.addEventListener('click', () => this.onEditCode?.(c.name));
        li.appendChild(btn);
      }
      list.appendChild(li);
    }
    if (controls.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No per-pixel controls.';
      this.card.appendChild(empty);
    } else {
      this.card.appendChild(list);
    }
  }
}

let inspector: CanvasInspector | null = null;

export function isCanvasInspectorActive(): boolean {
  return inspector !== null;
}

export function toggleCanvasInspector(
  stage: HTMLElement | null,
  canvas: HTMLCanvasElement | null,
  dataflow: PresetDataflow | null,
  onEditCode?: (control: string) => void,
  onScale?: (control: string, value: number) => void,
): boolean {
  if (inspector) {
    inspector.detach();
    inspector = null;
    return false;
  }
  if (!stage || !canvas) return false;
  inspector = new CanvasInspector();
  inspector.attach(stage, canvas, dataflow, onEditCode, onScale);
  return true;
}

export function updateCanvasInspectorDataflow(dataflow: PresetDataflow | null) {
  inspector?.updateDataflow(dataflow);
}

/** Compile `source` for its dataflow, then toggle the inspector over the
 * stage's canvas. A compile failure leaves the inspector with no controls
 * rather than throwing into the click path. */
export function toggleCanvasInspectorForSource(
  stage: HTMLElement | null,
  source: string | null | undefined,
  presetId: string | null | undefined,
  onEditCode?: (control: string) => void,
  onScale?: (control: string, value: number) => void,
): boolean {
  let dataflow: PresetDataflow | null = null;
  if (source) {
    try {
      const ir = compileMilkdropPresetSource(source, {
        id: presetId ?? 'current',
      }).ir;
      dataflow = analyzePresetDataflow(ir);
    } catch {
      dataflow = null;
    }
  }
  const canvas = stage?.querySelector('canvas') ?? null;
  return toggleCanvasInspector(stage, canvas, dataflow, onEditCode, onScale);
}
