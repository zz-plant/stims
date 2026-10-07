import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import {
  type AudioLevels,
  correlate,
  createVariableHistory,
} from '../../src/js/milkdrop/variable-history.ts';
import { publishVariables } from '../../src/js/milkdrop/variable-probe.ts';

/**
 * The reactivity meter answers "does my preset react to the music, and
 * through what?" by correlating each variable with each audio band.
 */
const levelsAt = (frame: number): AudioLevels => ({
  bass: 0.5 + 0.5 * Math.sin(frame / 3),
  mid: 0.5 + 0.5 * Math.sin(frame / 5 + 1),
  treb: 0.5 + 0.5 * Math.cos(frame / 7),
  bass_att: 0.5,
  mid_att: 0.5,
  treb_att: 0.5,
});

function feed(
  push: (variables: Record<string, number>, levels?: AudioLevels) => void,
  frames: number,
  variablesAt: (frame: number, levels: AudioLevels) => Record<string, number>,
) {
  for (let frame = 0; frame < frames; frame += 1) {
    const levels = levelsAt(frame);
    push(variablesAt(frame, levels), levels);
  }
}

describe('correlate', () => {
  test('is 1 for a scaled copy, -1 inverted, 0 against a constant', () => {
    const a = [1, 2, 3, 4, 5];
    expect(correlate(a, [2, 4, 6, 8, 10])).toBeCloseTo(1, 6);
    expect(correlate(a, [5, 4, 3, 2, 1])).toBeCloseTo(-1, 6);
    expect(correlate(a, [3, 3, 3, 3, 3])).toBe(0);
  });
});

describe('variable history reactivity', () => {
  test('tags a variable with the band it follows, inverted included', () => {
    const history = createVariableHistory();
    feed(history.push, 60, (frame, levels) => ({
      q1: 2 * levels.bass,
      zoom: 1 - 0.1 * levels.treb,
      rot: 0.01,
      time: frame / 60,
    }));
    const byName = Object.fromEntries(
      history.rows().map((row) => [row.name, row.reacts]),
    );
    expect(byName.q1?.band).toBe('bass');
    expect(byName.q1?.r).toBeGreaterThan(0.99);
    expect(byName.zoom?.band).toBe('treb');
    expect(byName.zoom?.r).toBeLessThan(-0.99);
    expect(byName.rot).toBeNull();
    // A steadily rising clock is not "following the music".
    expect(byName.time).toBeNull();
  });

  test('a slow drift that happens to track a band in level is not a follower', () => {
    const history = createVariableHistory();
    for (let frame = 0; frame < 90; frame += 1) {
      const levels = {
        ...levelsAt(frame),
        // A rising band with frame-to-frame jitter…
        bass_att: frame / 100 + 0.05 * Math.sin(frame * 1.7),
      };
      // …and a variable that only rises smoothly.
      history.push({ drift: frame / 100 }, levels);
    }
    expect(history.rows()[0]?.reacts).toBeNull();
  });

  test('reports nothing until there are enough frames', () => {
    const history = createVariableHistory();
    feed(history.push, 10, (_, levels) => ({ q1: levels.bass }));
    expect(history.rows()[0]?.reacts).toBeNull();
    expect(history.reactivitySummary().state).toBe('measuring');
  });

  test('summarises followers strongest first, or says when the audio is flat', () => {
    const history = createVariableHistory();
    feed(history.push, 60, (_, levels) => ({
      q2: levels.mid + 0.3 * Math.sin(levels.bass * 9),
      q1: levels.bass,
    }));
    const summary = history.reactivitySummary();
    expect(summary.state).toBe('measured');
    if (summary.state !== 'measured') return;
    expect(summary.followers[0]?.name).toBe('q1');

    const silent = createVariableHistory();
    for (let frame = 0; frame < 40; frame += 1) {
      silent.push(
        { q1: frame },
        {
          bass: 0,
          mid: 0,
          treb: 0,
          bass_att: 0,
          mid_att: 0,
          treb_att: 0,
        },
      );
    }
    expect(silent.reactivitySummary().state).toBe('silent');
  });

  test('reset forgets the audio as well as the variables', () => {
    const history = createVariableHistory();
    feed(history.push, 40, (_, levels) => ({ q1: levels.bass }));
    history.reset();
    feed(history.push, 10, (_, levels) => ({ q1: levels.bass }));
    expect(history.reactivitySummary().state).toBe('measuring');
  });
});

describe('Inspect tab: reactivity and frame stepping', () => {
  let OriginalMutationObserver: typeof globalThis.MutationObserver;
  beforeAll(() => {
    OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;
  });
  afterAll(() => {
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  const mount = (freezeApplies: boolean) => {
    const onSetStageFrozen = mock((frozen: boolean) =>
      freezeApplies ? frozen : false,
    );
    const onStepFrame = mock(() => true);
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
      onSetStageFrozen,
      onStepFrame,
    });
    document.body.appendChild(panel.element);
    panel.element
      .querySelector<HTMLButtonElement>('[data-pane="inspect"]')
      ?.click();
    return { panel, onSetStageFrozen, onStepFrame };
  };
  const button = (panel: EditorPanel, label: RegExp) =>
    Array.from(
      panel.element.querySelectorAll<HTMLButtonElement>(
        '.stims-editor__inspect-bar button',
      ),
    ).find((b) => label.test(b.textContent ?? ''));
  const repaint = (panel: EditorPanel) =>
    panel.element
      .querySelector('.stims-editor__inspect-filter')
      ?.dispatchEvent(new Event('input'));

  test('shows which band each variable follows, and a summary line', () => {
    const { panel } = mount(true);
    feed(publishVariables, 60, (_, levels) => ({ q1: levels.bass, q2: 0.4 }));
    repaint(panel);
    const tag = panel.element.querySelector<HTMLElement>(
      '[data-name="q1"] .stims-editor__inspect-reacts',
    );
    expect(tag?.dataset.band).toBe('bass');
    const summary = panel.element.querySelector(
      '.stims-editor__inspect-reactivity',
    )?.textContent;
    expect(summary).toContain('q1 (bass)');
    expect(summary).not.toContain('q2');
    panel.dispose();
  });

  test('Freeze holds the stage and enables Step, which asks for one frame', () => {
    const { panel, onSetStageFrozen, onStepFrame } = mount(true);
    const step = button(panel, /Step/u);
    expect(step?.disabled).toBe(true);
    button(panel, /^Freeze$/u)?.click();
    expect(onSetStageFrozen).toHaveBeenLastCalledWith(true);
    expect(step?.disabled).toBe(false);
    step?.click();
    expect(onStepFrame).toHaveBeenCalledTimes(1);
    button(panel, /Unfreeze/u)?.click();
    expect(onSetStageFrozen).toHaveBeenLastCalledWith(false);
    expect(step?.disabled).toBe(true);
    panel.dispose();
  });

  test('a stepped frame shows at once instead of waiting out the repaint throttle', () => {
    const { panel } = mount(true);
    button(panel, /^Freeze$/u)?.click();
    publishVariables({ q1: 1 });
    publishVariables({ q1: 2 });
    const value = panel.element.querySelector(
      '[data-name="q1"] .stims-editor__inspect-value',
    )?.textContent;
    expect(Number(value)).toBe(2);
    panel.dispose();
  });

  test('without live audio Freeze says why instead of pretending', () => {
    const { panel } = mount(false);
    button(panel, /^Freeze$/u)?.click();
    expect(button(panel, /Step/u)?.disabled).toBe(true);
    expect(
      panel.element.querySelector('.stims-editor__inspect-note')?.textContent,
    ).toContain('Start audio');
    panel.dispose();
  });

  test('a hold from elsewhere (Space, the dock) is reflected', () => {
    const { panel } = mount(true);
    panel.setStageFrozen(true);
    expect(button(panel, /Unfreeze/u)).toBeDefined();
    expect(button(panel, /Step/u)?.disabled).toBe(false);
    panel.dispose();
  });
});
