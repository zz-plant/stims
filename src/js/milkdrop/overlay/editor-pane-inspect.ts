/**
 * The Inspect pane: live values of the preset's own variables with history,
 * pins and the audio band each follows, plus Freeze and Step for the stage.
 */
import { createVariableHistory } from '../variable-history.ts';
import { subscribeVariables } from '../variable-probe.ts';
import type { EditorPaneHost } from './editor-pane-host.ts';

function formatInspectNumber(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000 || abs < 0.001) return value.toExponential(2);
  return value.toFixed(abs >= 100 ? 1 : 3);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildSparkline(
  history: readonly number[],
  min: number,
  max: number,
): SVGElement {
  const width = 80;
  const height = 18;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'stims-editor__inspect-spark');
  svg.setAttribute('aria-hidden', 'true');
  if (history.length < 2) return svg;
  const span = max - min || 1;
  const step = width / (history.length - 1);
  const points = history
    .map((v, i) => {
      const y = height - 1 - ((v - min) / span) * (height - 2);
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);
  return svg;
}

export class InspectPane {
  readonly element: HTMLElement;
  private readonly variableHistory = createVariableHistory();
  private inspectList: HTMLElement | null = null;
  private inspectEmpty: HTMLElement | null = null;
  private inspectFilter = '';
  private inspectOnlyChanging = false;
  private inspectPaused = false;
  /** Mirrors the stage's hold state (Freeze here, Space, or the dock). */
  private stageFrozen = false;
  private freezeButton: HTMLButtonElement | null = null;
  private stepButton: HTMLButtonElement | null = null;
  private inspectReactivity: HTMLElement | null = null;
  private inspectLastPaint = 0;
  private disposeVariableFeed: (() => void) | null = null;

  constructor(
    readonly _host: EditorPaneHost,
    private readonly callbacks: {
      onSetStageFrozen?: (frozen: boolean) => boolean;
      onStepFrame?: () => boolean;
    },
  ) {
    this.element = this.renderInspectPane();
  }

  /** Inspect pane: every variable the preset's equations touch, live. The
   * feed only runs while this tab is showing, so it costs nothing otherwise. */
  private renderInspectPane(): HTMLElement {
    const pane = document.createElement('div');
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Live values of q1–q32 and every variable your equations set. Pin the ones you are tuning.';

    const bar = document.createElement('div');
    bar.className = 'stims-editor__inspect-bar';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = 'Filter variables';
    filter.setAttribute('aria-label', 'Filter variables');
    filter.className = 'stims-editor__inspect-filter';
    filter.addEventListener('input', () => {
      this.inspectFilter = filter.value;
      this.paintInspect(true);
    });
    const changingLabel = document.createElement('label');
    changingLabel.className = 'stims-editor__inspect-toggle';
    const changing = document.createElement('input');
    changing.type = 'checkbox';
    changing.addEventListener('change', () => {
      this.inspectOnlyChanging = changing.checked;
      this.paintInspect(true);
    });
    changingLabel.append(changing, ' Only changing');
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'stims-editor__inspect-btn';
    pause.textContent = 'Pause';
    pause.setAttribute('aria-pressed', 'false');
    pause.addEventListener('click', () => {
      this.inspectPaused = !this.inspectPaused;
      pause.textContent = this.inspectPaused ? 'Resume' : 'Pause';
      pause.setAttribute('aria-pressed', String(this.inspectPaused));
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'stims-editor__inspect-btn';
    reset.textContent = 'Reset';
    reset.title = 'Clear min/max and history';
    reset.addEventListener('click', () => {
      this.variableHistory.reset();
      this.paintInspect(true);
    });
    pause.title = 'Stop updating this list; the visuals keep running';
    const freeze = document.createElement('button');
    freeze.type = 'button';
    freeze.className = 'stims-editor__inspect-btn';
    freeze.textContent = 'Freeze';
    freeze.title = 'Hold the visuals on this frame';
    freeze.setAttribute('aria-pressed', 'false');
    freeze.addEventListener('click', () => {
      const wanted = !this.stageFrozen;
      const applied = this.callbacks.onSetStageFrozen?.(wanted) ?? false;
      this.setStageFrozen(applied);
      freezeNote.textContent =
        wanted && !applied
          ? 'Start audio to freeze \u2014 before that the stage is a preview.'
          : '';
    });
    const step = document.createElement('button');
    step.type = 'button';
    step.className = 'stims-editor__inspect-btn';
    step.textContent = 'Step \u25B8';
    step.title = 'Render one frame';
    step.setAttribute('aria-label', 'Step one frame');
    step.disabled = true;
    step.addEventListener('click', () => {
      this.callbacks.onStepFrame?.();
    });
    const freezeNote = document.createElement('span');
    freezeNote.className = 'stims-editor__hint stims-editor__inspect-note';
    freezeNote.setAttribute('aria-live', 'polite');
    this.freezeButton = freeze;
    this.stepButton = step;
    bar.append(filter, changingLabel, freeze, step, pause, reset, freezeNote);

    this.inspectReactivity = document.createElement('p');
    this.inspectReactivity.className =
      'stims-editor__hint stims-editor__inspect-reactivity';
    this.inspectReactivity.setAttribute('aria-live', 'polite');

    this.inspectEmpty = document.createElement('p');
    this.inspectEmpty.className = 'stims-editor__hint';
    this.inspectEmpty.textContent = 'Waiting for the first frame…';
    this.inspectList = document.createElement('div');
    this.inspectList.className = 'stims-editor__inspect';
    // pointerdown, not click: the list repaints several times a second, and a
    // repaint between press and release would swallow the click.
    this.inspectList.addEventListener('pointerdown', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-pin]',
      );
      if (!target?.dataset.pin) return;
      event.preventDefault();
      this.variableHistory.togglePin(target.dataset.pin);
      this.paintInspect(true);
    });
    pane.append(
      hint,
      bar,
      this.inspectReactivity,
      this.inspectEmpty,
      this.inspectList,
    );
    return pane;
  }
  /** Reflect the stage's hold state; called by the host whenever it changes. */
  setStageFrozen(frozen: boolean) {
    this.stageFrozen = frozen;
    if (this.freezeButton) {
      this.freezeButton.textContent = frozen ? 'Unfreeze' : 'Freeze';
      this.freezeButton.setAttribute('aria-pressed', String(frozen));
    }
    if (this.stepButton) this.stepButton.disabled = !frozen;
  }
  setInspectActive(active: boolean) {
    if (!active) {
      this.disposeVariableFeed?.();
      this.disposeVariableFeed = null;
      return;
    }
    if (this.disposeVariableFeed) return;
    this.disposeVariableFeed = subscribeVariables((variables, levels) => {
      if (this.inspectPaused) return;
      this.variableHistory.push(variables, levels);
      // While the stage is frozen, frames only arrive one Step at a time;
      // each one must show rather than fall inside the repaint throttle.
      this.paintInspect(this.stageFrozen);
    });
  }
  private paintInspect(force: boolean) {
    const list = this.inspectList;
    if (!list) return;
    const now = performance.now();
    if (!force && now - this.inspectLastPaint < 150) return;
    this.inspectLastPaint = now;

    const rows = this.variableHistory
      .rows({
        onlyChanging: this.inspectOnlyChanging,
        filter: this.inspectFilter,
      })
      .slice(0, 200);
    if (this.inspectEmpty) this.inspectEmpty.hidden = rows.length > 0;

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'stims-editor__inspect-row';
      el.dataset.name = row.name;

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'stims-editor__inspect-pin';
      pin.dataset.pin = row.name;
      pin.textContent = row.pinned ? '★' : '☆';
      pin.setAttribute(
        'aria-label',
        `${row.pinned ? 'Unpin' : 'Pin'} ${row.name}`,
      );
      pin.setAttribute('aria-pressed', String(row.pinned));

      const name = document.createElement('span');
      name.className = 'stims-editor__inspect-name';
      name.textContent = row.name;

      const value = document.createElement('span');
      value.className = 'stims-editor__inspect-value';
      value.textContent = formatInspectNumber(row.value);
      value.title = `min ${formatInspectNumber(row.min)} · max ${formatInspectNumber(row.max)}`;

      el.append(pin, name, value);
      // Always present (empty when nothing is followed) so the grid lines up.
      const tag = document.createElement('span');
      tag.className = 'stims-editor__inspect-reacts';
      if (row.reacts) {
        tag.dataset.band = row.reacts.band;
        tag.textContent = `${row.reacts.r < 0 ? '\u2212' : ''}${row.reacts.band}`;
        tag.title = `Follows ${row.reacts.band} (r = ${row.reacts.r.toFixed(2)})${
          row.reacts.r < 0 ? ', inverted' : ''
        }`;
      }
      el.appendChild(tag);
      el.appendChild(buildSparkline(row.history, row.min, row.max));
      fragment.appendChild(el);
    }
    list.replaceChildren(fragment);
    this.paintReactivitySummary();
  }
  /** One line answering "does this preset react to the music, and how?" */
  private paintReactivitySummary() {
    const line = this.inspectReactivity;
    if (!line) return;
    const summary = this.variableHistory.reactivitySummary();
    if (summary.state === 'measuring') {
      line.textContent = 'Measuring what follows the audio\u2026';
      return;
    }
    if (summary.state === 'silent') {
      line.textContent =
        'The audio is flat, so nothing can follow it yet \u2014 play some music.';
      return;
    }
    if (summary.followers.length === 0) {
      line.textContent =
        'Nothing in this preset\u2019s equations follows the audio. Try driving a q-var or zoom from bass_att.';
      return;
    }
    const shown = summary.followers.slice(0, 6);
    const rest = summary.followers.length - shown.length;
    line.textContent = `Follows the audio: ${shown
      .map((entry) => `${entry.name} (${entry.band})`)
      .join(', ')}${rest > 0 ? ` and ${rest} more` : ''}.`;
  }

  /** Forget recorded values: they belong to the preset that made them. */
  resetHistory() {
    this.variableHistory.reset();
  }

  dispose() {
    this.setInspectActive(false);
  }
}
