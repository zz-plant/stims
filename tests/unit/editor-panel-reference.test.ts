import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

/**
 * The Reference tab must insert what it shows, where the cursor is, and only
 * list things the compiler accepts.
 */
describe('editor panel Reference tab', () => {
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

  const mount = (source: string) => {
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
    });
    document.body.appendChild(panel.element);
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    } satisfies MilkdropEditorSessionState);
    return panel;
  };
  const search = (panel: EditorPanel, text: string) => {
    const input = panel.element.querySelector<HTMLInputElement>(
      '.stims-editor__ref-search',
    );
    if (!input) throw new Error('no search box');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const rows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>('.stims-editor__ref-row'),
    ).map((row) => row.dataset.ref);

  test('searching narrows the list and the best match comes first', () => {
    const panel = mount('zoom=1\n');
    search(panel, 'clamp');
    expect(rows(panel)[0]).toBe('clamp');
    search(panel, 'zzzz-no-such-thing');
    expect(rows(panel)).toEqual([]);
    expect(panel.element.textContent).toContain('Nothing matches');
    panel.dispose();
  });

  test('clicking a result inserts it at the cursor, inline', () => {
    const panel = mount('zoom=1\n');
    search(panel, 'clamp');
    panel.element
      .querySelector<HTMLElement>('.stims-editor__ref-row[data-ref="clamp"]')
      ?.click();
    // Inline: with the cursor at the start of `zoom=1`, the insert sits
    // directly against it on the same line. The line-oriented snippet
    // inserter would have pushed `zoom=1` onto its own line.
    expect(panel.getEditorSource().split('\n')[0]).toMatch(
      /^clamp\([^)]*\)zoom=1$/u,
    );
    panel.dispose();
  });
});
