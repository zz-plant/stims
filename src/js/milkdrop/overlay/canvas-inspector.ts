/**
 * Click-to-Demystify canvas inspector (#1680).
 *
 * Passive at runtime: no work during playback. On a click while inspect mode
 * is active, the clicked pixel is converted to normalized MilkDrop mesh
 * coordinates and the preset's dataflow is consulted to name the per-pixel
 * controls that drive that spot and the audio signals behind them. A small
 * floating card renders the result; Escape or a click elsewhere dismisses it.
 *
 * Each control in the card has an Edit code button that opens the editor on
 * the line that assigns it. Where the preset's base value reaches the
 * picture (no per-frame code overwrites it, and its per-pixel code builds
 * on it), a slider scales that value about its neutral point: 0 removes
 * the effect, 1 is the preset, 2 doubles it. Where the code sets the
 * control from scratch each frame, a slider could not move it, so the card
 * says so instead.
 */

import '../../../css/shell/canvas-inspector.css';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  analyzePresetDataflow,
  type PresetDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { baseReachesControl } from '../control-line.ts';

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
/** Room kept free at the stage's bottom, where the dock sits. */
const DOCK_CLEARANCE = 96;

/** What the card can do beyond naming controls; each part is optional. */
export interface CanvasInspectorHooks {
  /** Open the editor on the line that assigns `control`. */
  editCode?: (control: string) => void;
  /** The preset's own per-frame value of `control`, before the slider. */
  readBase?: (control: string) => number | undefined;
  /** Apply a value to the running preset without recompiling. */
  setLive?: (control: string, value: number) => void;
}

/**
 * The value a control has when it does nothing: 1 for the scale-like
 * fields, 0 for the rest. The slider scales the preset's distance from it.
 */
export function neutralValue(control: string): number {
  return control === 'zoom' || control === 'sx' || control === 'sy' ? 1 : 0;
}

/** The control's value with the preset's effect scaled by `factor`. */
export function scaleAboutNeutral(
  control: string,
  base: number,
  factor: number,
): number {
  const neutral = neutralValue(control);
  return neutral + (base - neutral) * factor;
}

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
  private source: string | null = null;
  private hooks: CanvasInspectorHooks = {};
  private dismissHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private attachedCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = INSPECTOR_CLASS;

    this.card = document.createElement('div');
    this.card.className = 'stims-canvas-inspector__card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'What drives this spot');
    this.card.hidden = true;
    this.element.appendChild(this.card);
  }

  attach(
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    dataflow: PresetDataflow | null,
    hooks: CanvasInspectorHooks,
    source: string | null,
  ) {
    this.dataflow = dataflow;
    this.hooks = hooks;
    this.source = source;
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
    this.card.hidden = true;
    this.card.replaceChildren();
  }

  private renderCard(
    result: InspectResult,
    px: number,
    py: number,
    width: number,
    height: number,
  ) {
    const { coords, controls } = result;
    this.card.replaceChildren();
    this.card.hidden = false;

    const title = document.createElement('p');
    title.className = 'stims-canvas-inspector__title';
    title.textContent = 'What drives this spot';
    this.card.appendChild(title);

    const where = document.createElement('p');
    where.className = 'stims-canvas-inspector__where';
    where.textContent = `u ${coords.u.toFixed(2)} · v ${coords.v.toFixed(2)} · rad ${coords.rad.toFixed(2)}`;
    this.card.appendChild(where);

    if (controls.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'stims-canvas-inspector__empty';
      empty.textContent =
        'No per-pixel code: this preset moves every spot the same way.';
      this.card.appendChild(empty);
      this.place(px, py, width, height);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'stims-canvas-inspector__controls';
    let fromScratch = 0;
    for (const c of controls) {
      const li = document.createElement('li');
      li.className = 'stims-canvas-inspector__control';
      const head = document.createElement('span');
      head.className = 'stims-canvas-inspector__head';
      const name = document.createElement('code');
      name.className = 'stims-canvas-inspector__name';
      name.textContent = c.name;
      head.appendChild(name);
      const audio = document.createElement('span');
      audio.className = 'stims-canvas-inspector__audio';
      audio.textContent = c.audio.length
        ? `follows ${c.audio.join(', ')}`
        : 'no sound';
      head.appendChild(audio);
      if (this.hooks.editCode) {
        const editCode = this.hooks.editCode;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stims-canvas-inspector__edit';
        btn.textContent = 'Edit code';
        btn.setAttribute('aria-label', `Edit the code for ${c.name}`);
        btn.addEventListener('click', () => editCode(c.name));
        head.appendChild(btn);
      }
      li.appendChild(head);

      const base = this.hooks.readBase?.(c.name);
      const scalable =
        this.source !== null && baseReachesControl(this.source, c.name);
      if (!scalable) {
        fromScratch += 1;
      } else if (
        this.hooks.setLive &&
        base !== undefined &&
        Number.isFinite(base)
      ) {
        const setLive = this.hooks.setLive;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'stims-canvas-inspector__slider';
        slider.min = '0';
        slider.max = '2';
        slider.step = '0.05';
        slider.value = '1';
        slider.setAttribute('aria-label', `Scale ${c.name}`);
        slider.setAttribute('aria-valuetext', '1x, as the preset has it');
        slider.addEventListener('input', () => {
          const factor = Number(slider.value);
          slider.setAttribute('aria-valuetext', `${factor}x`);
          setLive(c.name, scaleAboutNeutral(c.name, base, factor));
        });
        li.appendChild(slider);
      }
      list.appendChild(li);
    }
    this.card.appendChild(list);
    if (fromScratch > 0) {
      const note = document.createElement('p');
      note.className = 'stims-canvas-inspector__note';
      note.textContent =
        fromScratch === controls.length
          ? 'No sliders: this preset sets these from scratch each frame, so only its code changes them.'
          : 'Controls without a slider are set from scratch each frame, so only their code changes them.';
      this.card.appendChild(note);
    }
    this.place(px, py, width, height);
  }

  /** Beside the click, kept inside the stage by the card's measured size. */
  private place(px: number, py: number, width: number, height: number) {
    const cardWidth = this.card.offsetWidth || 264;
    const cardHeight = this.card.offsetHeight || 0;
    const left =
      px + 12 + cardWidth > width - 8 ? px - 12 - cardWidth : px + 12;
    // The dock covers the stage's bottom edge; stay above it.
    const top = Math.min(py + 12, height - DOCK_CLEARANCE - cardHeight);
    this.card.style.left = `${Math.max(8, left)}px`;
    this.card.style.top = `${Math.max(8, top)}px`;
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
  hooks: CanvasInspectorHooks = {},
  source: string | null = null,
): boolean {
  if (inspector) {
    inspector.detach();
    inspector = null;
    return false;
  }
  if (!stage || !canvas) return false;
  inspector = new CanvasInspector();
  inspector.attach(stage, canvas, dataflow, hooks, source);
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
  hooks: CanvasInspectorHooks = {},
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
  return toggleCanvasInspector(stage, canvas, dataflow, hooks, source ?? null);
}
