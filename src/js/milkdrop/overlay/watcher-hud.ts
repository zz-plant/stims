/**
 * The stage watch HUD: a small imperative canvas overlay over the running
 * stage that plots the variables the author pinned in the editor's Inspect
 * tab, at the delivered display frame rate.
 *
 * Design constraints, all from the roadmap's exit criterion ("variable watch
 * graphs update at delivered display frame rates without hitching the main
 * JS thread"):
 *
 *  - The feed rides `publishVariables`, the hook the frame loop already
 *    calls per frame; with the HUD off there is no listener and the loop's
 *    `hasVariableListeners()` check costs the same nothing it always did.
 *    Recording is one typed-ring write per watched variable per frame.
 *  - Painting runs on its own `requestAnimationFrame` loop, off the render
 *    path: per paint it strokes one polyline per watched variable straight
 *    from its ring — O(watched × samples) with no allocations in the steady
 *    state (canvas contexts and label cells are captured once per watch-set
 *    change; a label's text is written only when its formatted value
 *    actually changed).
 *  - It is engine-overlay DOM/canvas by hand, not a React portal — the
 *    stage's surfaces are imperative by convention (docs/ARCHITECTURE.md).
 *
 * The watched set survives the editor closing, because the point of a stage
 * HUD is to keep watching while the preset runs full-screen. It resets with
 * the page.
 */
import { SampleRing } from '../sample-ring.ts';
import { subscribeVariables } from '../variable-probe.ts';
import { formatInspectNumber } from './editor-pane-inspect.ts';

/** Samples plotted per variable: four seconds at 60 Hz. */
export const WATCH_HUD_CAPACITY = 240;
/**
 * Watched variables kept at once. The pin list comes from the author, so the
 * bound is a guard against pathological presets, not a tuning knob; pins
 * beyond it are ignored, earliest first.
 */
export const MAX_WATCHED_VARIABLES = 8;
/** DOM value labels rewrite at most this often; the graphs run at full rate. */
const LABEL_REWRITE_MS = 200;

const HUD_CLASS = 'stims-watch-hud';

/** One row's imperatively-held paint handles, captured at row build time. */
type WatchRow = {
  ring: SampleRing;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  valueCell: HTMLElement;
  paintedWidth: number;
  paintedHeight: number;
};

class WatcherHud {
  readonly element: HTMLElement;
  private readonly rowsLayer: HTMLElement;
  private readonly hint: HTMLElement;
  /** Rows in watch order; rebuilt only when the watched set changes. */
  private rows: WatchRow[] = [];
  private readonly rings = new Map<string, SampleRing>();
  private watchedNames: string[] = [];
  private disposeFeed: (() => void) | null = null;
  private rafHandle = 0;
  private lastLabelPaint = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = HUD_CLASS;
    // The HUD is a read-only instrument over a running stage; it must never
    // eat a tap meant for the visuals. Its rows have no interactions.
    this.element.setAttribute('aria-hidden', 'true');

    this.rowsLayer = document.createElement('div');
    this.rowsLayer.className = 'stims-watch-hud__rows';

    this.hint = document.createElement('p');
    this.hint.className = 'stims-watch-hud__hint';
    this.hint.textContent =
      'Watching nothing yet. Pin variables in the editor\u2019s Inspect tab to plot them here.';

    this.element.append(this.rowsLayer, this.hint);
  }

  attach(stage: HTMLElement) {
    stage.appendChild(this.element);
    this.start();
  }

  detach() {
    this.stop();
    this.element.remove();
  }

  /** The pinned set changed (the Inspect pane forwards its pins). */
  setWatched(names: readonly string[]) {
    const next: string[] = [];
    for (const name of names) {
      if (next.length >= MAX_WATCHED_VARIABLES) break;
      if (!next.includes(name)) next.push(name);
    }
    const changed =
      next.length !== this.watchedNames.length ||
      next.some((name, i) => name !== this.watchedNames[i]);
    if (!changed) return;
    this.watchedNames = next;
    // Rings keep their samples across re-pins of the same name, so a pin
    // toggle does not blank four seconds of history. Rings for names that
    // are no longer watched are dropped, keeping the map bounded by the
    // watched set itself.
    for (const name of next) {
      if (!this.rings.has(name)) {
        this.rings.set(name, new SampleRing(WATCH_HUD_CAPACITY));
      }
    }
    for (const name of [...this.rings.keys()]) {
      if (!next.includes(name)) this.rings.delete(name);
    }
    this.hint.hidden = next.length > 0;
    this.rebuildRows();
  }

  private rebuildRows() {
    this.rowsLayer.replaceChildren();
    this.rows = [];
    for (const name of this.watchedNames) {
      const row = document.createElement('div');
      row.className = 'stims-watch-hud__row';
      const label = document.createElement('span');
      label.className = 'stims-watch-hud__name';
      label.textContent = name;
      const value = document.createElement('span');
      value.className = 'stims-watch-hud__value';
      const canvas = document.createElement('canvas');
      canvas.className = 'stims-watch-hud__graph';
      row.append(label, value, canvas);
      this.rowsLayer.appendChild(row);
      this.rows.push({
        ring: this.rings.get(name) as SampleRing,
        canvas,
        ctx: canvas.getContext('2d'),
        valueCell: value,
        paintedWidth: 0,
        paintedHeight: 0,
      });
    }
    this.lastLabelPaint = 0;
  }

  private start() {
    if (this.disposeFeed) return;
    this.disposeFeed = subscribeVariables((variables) => {
      for (const name of this.watchedNames) {
        const raw = variables[name];
        const ring = this.rings.get(name);
        if (ring) ring.push(Number.isFinite(raw) ? raw : 0);
      }
    });
    const loop = () => {
      this.paint();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private stop() {
    this.disposeFeed?.();
    this.disposeFeed = null;
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  /** One display-rate paint: graphs every call, labels on their own clock. */
  private paint() {
    const scale = globalThis.devicePixelRatio || 1;
    for (const row of this.rows) {
      this.plot(row, scale);
    }

    const now = performance.now();
    if (now - this.lastLabelPaint < LABEL_REWRITE_MS) return;
    this.lastLabelPaint = now;
    for (const row of this.rows) {
      const text = formatInspectNumber(row.ring.newest());
      if (row.valueCell.textContent !== text) {
        row.valueCell.textContent = text;
      }
    }
  }

  /** Stroke one row's window, oldest → newest, scaled to its own min/max. */
  private plot(row: WatchRow, scale: number) {
    const ctx = row.ctx;
    if (!ctx) return;
    const width = Math.max(1, Math.floor(row.canvas.clientWidth));
    const height = Math.max(1, Math.floor(row.canvas.clientHeight));
    if (width !== row.paintedWidth || height !== row.paintedHeight) {
      row.paintedWidth = width;
      row.paintedHeight = height;
      row.canvas.width = Math.floor(width * scale);
      row.canvas.height = Math.floor(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    ctx.clearRect(0, 0, width, height);

    const ring = row.ring;
    if (ring.count < 2) return;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < ring.count; i += 1) {
      const sample = ring.at(i);
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    const span = max - min || 1;
    const step = width / (ring.count - 1);
    ctx.beginPath();
    for (let i = 0; i < ring.count; i += 1) {
      const y = height - 1 - ((ring.at(i) - min) / span) * (height - 2);
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    }
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}

/**
 * The names the HUD should plot — forwarded from the Inspect pane's pins and
 * remembered so the HUD keeps its watch set when the editor closes.
 */
let currentWatchedNames: string[] = [];

export function setWatchedVariables(names: readonly string[]): void {
  currentWatchedNames = [...names];
  hud?.setWatched(currentWatchedNames);
}

/** Module state: one HUD per page, on until it is toggled off. */
let hud: WatcherHud | null = null;

export function isWatchHudActive(): boolean {
  return hud !== null;
}

/**
 * Show or hide the HUD over `stage`. Returns the state now in effect, so the
 * calling surface (command palette, agent action) can announce it.
 */
export function toggleWatcherHud(stage: HTMLElement | null): boolean {
  if (hud) {
    hud.detach();
    hud = null;
    return false;
  }
  if (!stage) return false;
  hud = new WatcherHud();
  hud.attach(stage);
  hud.setWatched(currentWatchedNames);
  return true;
}
