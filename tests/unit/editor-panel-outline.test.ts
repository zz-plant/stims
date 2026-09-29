import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

describe('editor panel Outline tab', () => {
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

  const SOURCE = [
    'title=T',
    'zoom=1.01',
    'per_frame_1=zoom = zoom + 0.01;',
    'per_frame_2=rot = rot + 0.01;',
    'per_pixel_1=rot = rot + rad;',
  ].join('\n');

  const mount = (source: string) => {
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onRevertToActive: mock(() => {}),
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
    });
    return panel;
  };
  const rows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>('.stims-editor__outline-row'),
    );
  const cursorLine = (panel: EditorPanel) => {
    const view = (
      panel as unknown as {
        editor: {
          state: {
            selection: { main: { from: number } };
            doc: { lineAt: (pos: number) => { number: number } };
          };
        };
      }
    ).editor;
    return view.state.doc.lineAt(view.state.selection.main.from).number;
  };

  test('lists the parts of the preset in buffer order with their ranges', () => {
    const panel = mount(SOURCE);
    expect(rows(panel).map((row) => row.textContent)).toEqual([
      'Settingslines 1–2',
      'Per-frame equationslines 3–4',
      'Per-pixel equationsline 5',
    ]);
    panel.dispose();
  });

  test('clicking a part moves the cursor to its first line', () => {
    const panel = mount(SOURCE);
    rows(panel)
      .find((row) => row.dataset.kind === 'per-pixel')
      ?.click();
    expect(cursorLine(panel)).toBe(5);
    panel.dispose();
  });

  test('follows the source when the preset changes', () => {
    const panel = mount(SOURCE);
    panel.setSessionState({
      source: 'per_pixel_1=a=1;\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: true,
    });
    expect(rows(panel).map((row) => row.dataset.kind)).toEqual(['per-pixel']);
    panel.dispose();
  });

  test('Tune stays the default tab', () => {
    const panel = mount(SOURCE);
    const selected = panel.element.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect((selected as HTMLElement | null)?.dataset.pane).toBe('tune');
    panel.dispose();
  });
});
