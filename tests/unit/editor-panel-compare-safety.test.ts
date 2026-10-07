import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorView } from '@codemirror/view';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

/**
 * The edit → compare loop must never paste one preset's code into another,
 * and must always have a way back to the original. Each test here was a path
 * that did one or the other.
 */

const ORIGINAL_A = 'title=Alpha\nzoom=1.000\nrot=0.000\n';
const ORIGINAL_B = 'title=Beta\nzoom=0.900\nwarp=0.200\n';

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

function mount(originals: Record<string, string> = {}) {
  let activeId: string | null = null;
  const onEditorSourceChange = mock((_source: string) => {});
  const panel = new EditorPanel({
    onEditorSourceChange,
    getOriginalSource: async () =>
      activeId === null ? null : (originals[activeId] ?? null),
    onDuplicatePreset: mock(() => {}),
    onExport: mock(() => {}),
    onDeletePreset: mock(() => {}),
    onRequestImport: mock(() => {}),
    onCopyShareLink: mock(() => {}),
  });
  document.body.appendChild(panel.element);
  const load = (id: string, source: string) => {
    activeId = id;
    const compiled = compileMilkdropPresetSource(source, { id });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
  };
  const click = (selector: string) =>
    panel.element.querySelector<HTMLButtonElement>(selector)?.click();
  const undo = () => click('[aria-label="Undo last edit"]');
  const dispose = () => {
    panel.dispose();
    panel.element.remove();
  };
  return { panel, load, click, undo, onEditorSourceChange, dispose };
}

describe('editor undo history', () => {
  test('Undo right after a preset loads leaves its code alone', () => {
    const { panel, load, undo, dispose } = mount();
    load('alpha', ORIGINAL_A);
    undo();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    dispose();
  });

  test('Undo after switching presets never brings back the previous one', () => {
    const { panel, load, undo, dispose } = mount();
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    load('beta', ORIGINAL_B);
    undo();
    undo();
    expect(panel.getEditorSource()).toBe(ORIGINAL_B);
    dispose();
  });

  test('edits made after a load still undo', () => {
    const { panel, load, undo, dispose } = mount();
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    expect(panel.getEditorSource()).toContain('zoom=1.5');
    undo();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    dispose();
  });
});

describe('A/B compare', () => {
  test('the first press compares the edit against the original preset', async () => {
    const { panel, load, onEditorSourceChange, dispose } = mount({
      alpha: ORIGINAL_A,
    });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    const edited = panel.getEditorSource();

    await panel.toggleAbSnapshot();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    expect(onEditorSourceChange).toHaveBeenLastCalledWith(ORIGINAL_A);
    expect(
      panel.element.querySelector('[data-action="ab-toggle"]')?.textContent,
    ).toBe('Original');

    await panel.toggleAbSnapshot();
    expect(panel.getEditorSource()).toBe(edited);
    expect(
      panel.element.querySelector('[data-action="ab-toggle"]')?.textContent,
    ).toBe('Your edit');
    dispose();
  });

  test('with no edits there is nothing to swap in', async () => {
    const { panel, load, onEditorSourceChange, dispose } = mount({
      alpha: ORIGINAL_A,
    });
    load('alpha', ORIGINAL_A);
    await panel.toggleAbSnapshot();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    expect(onEditorSourceChange).not.toHaveBeenCalled();
    expect(panel.getSnapshotState().sourceA).toBeNull();
    dispose();
  });

  test('slots taken on one preset are dropped when another loads', async () => {
    const { panel, load, dispose } = mount({
      alpha: ORIGINAL_A,
      beta: ORIGINAL_B,
    });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    await panel.toggleAbSnapshot();
    load('beta', ORIGINAL_B);
    expect(panel.getSnapshotState()).toEqual({
      slot: 'A',
      sourceA: null,
      sourceB: null,
    });
    // Toggling now compares Beta with Beta's original, not with Alpha.
    await panel.toggleAbSnapshot();
    expect(panel.getEditorSource()).toBe(ORIGINAL_B);
    dispose();
  });

  test('a swap is not an undo step', async () => {
    const { panel, load, undo, dispose } = mount({ alpha: ORIGINAL_A });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    const edited = panel.getEditorSource();
    await panel.toggleAbSnapshot(); // showing the original
    await panel.toggleAbSnapshot(); // back on the edit
    undo();
    // The one undo step is the edit itself, not a swap.
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    expect(edited).not.toBe(ORIGINAL_A);
    dispose();
  });
});

describe('revert to original', () => {
  test('puts the original back as an undoable edit', async () => {
    const { panel, load, click, undo, onEditorSourceChange, dispose } = mount({
      alpha: ORIGINAL_A,
    });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    const edited = panel.getEditorSource();

    click('[data-action="editor-revert-original"]');
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    expect(onEditorSourceChange).toHaveBeenLastCalledWith(ORIGINAL_A);

    undo();
    expect(panel.getEditorSource()).toBe(edited);
    dispose();
  });

  test('checkpoints are kept with the preset they were taken on', async () => {
    const { panel, load, click, dispose } = mount({
      alpha: ORIGINAL_A,
      beta: ORIGINAL_B,
    });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    click('[data-action="editor-revert-original"]');
    await Promise.resolve();
    await Promise.resolve();
    const restoreButtons = () =>
      [...panel.element.querySelectorAll('button')].filter(
        (button) => button.textContent === 'Restore',
      );
    expect(restoreButtons().length).toBe(1);

    load('beta', ORIGINAL_B);
    expect(restoreButtons().length).toBe(0);
    load('alpha', ORIGINAL_A);
    expect(restoreButtons().length).toBe(1);
    dispose();
  });
});

describe('the original, while A/B shows it', () => {
  test('is read-only, and going back restores the edit with its undo', async () => {
    const { panel, load, undo, dispose } = mount({ alpha: ORIGINAL_A });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    // CodeMirror's read-only state refuses input while leaving the content
    // selectable, so it is read from the state, not from contenteditable.
    const readOnly = () => {
      const dom = panel.element.querySelector<HTMLElement>('.cm-editor');
      return dom ? EditorView.findFromDOM(dom)?.state.readOnly : undefined;
    };
    expect(readOnly()).toBe(false);
    await panel.toggleAbSnapshot();
    expect(readOnly()).toBe(true);

    await panel.toggleAbSnapshot();
    expect(readOnly()).toBe(false);
    undo();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    dispose();
  });

  test('Revert from the original view can still be undone back to the edit', async () => {
    const { panel, load, click, undo, dispose } = mount({ alpha: ORIGINAL_A });
    load('alpha', ORIGINAL_A);
    panel.writeVariableToEditor('zoom', 1.5);
    const edited = panel.getEditorSource();
    await panel.toggleAbSnapshot(); // showing the original
    click('[data-action="editor-revert-original"]');
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.getEditorSource()).toBe(ORIGINAL_A);
    undo();
    expect(panel.getEditorSource()).toBe(edited);
    dispose();
  });
});
