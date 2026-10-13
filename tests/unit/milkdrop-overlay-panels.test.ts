import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

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
      onDuplicatePreset: mock(),
      onExport: mock(),
      onDeletePreset: mock(),
      onRequestImport: mock(),
      onCopyShareLink: mock(),
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
      '.stims-editor__recipe-add[data-recipe="bass-zoom"]',
    ) as HTMLButtonElement | null;
    if (!snippetButton) {
      throw new Error('Expected a snippet button to exist.');
    }

    snippetButton.click();
    expect(harness.onEditorSourceChange).not.toHaveBeenCalled();

    await waitForCalls(harness.onEditorSourceChange, 1);

    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);
    expect(harness.onEditorSourceChange.mock.calls[0]?.[0]).toContain(
      'per_frame_1=zoom = zoom + 0.06*(bass_att - 1);',
    );

    harness.restore();
  });

  test('update now flushes the current draft immediately and clears the debounce', async () => {
    const harness = createEditorPanelHarness();

    const snippetButton = document.querySelector(
      '.stims-editor__recipe-add[data-recipe="bass-zoom"]',
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
      '.stims-editor__recipe-add[data-recipe="bass-zoom"]',
    ) as HTMLButtonElement | null;
    if (!snippetButton) {
      throw new Error('Expected a snippet button to exist.');
    }

    snippetButton.click();
    harness.panel.setSessionState(harness.state);

    const editorText = document.querySelector(
      '.cm-content',
    ) as HTMLElement | null;
    expect(editorText?.textContent).toContain('bass_att - 1');

    await waitForCalls(harness.onEditorSourceChange, 1);
    expect(harness.onEditorSourceChange).toHaveBeenCalledTimes(1);
    expect(harness.onEditorSourceChange.mock.calls[0]?.[0]).toContain(
      'per_frame_1=zoom = zoom + 0.06*(bass_att - 1);',
    );

    harness.restore();
  });
});
