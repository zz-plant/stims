import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

/**
 * The Compat tab is only useful if it lists what is wrong, says how many
 * things there are without opening it, and takes you to the line.
 */
describe('editor panel Compat tab', () => {
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
    const compiled = compileMilkdropPresetSource(source, { id: 'compat-ui' });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
    return panel;
  };
  const tab = (panel: EditorPanel) =>
    panel.element.querySelector<HTMLElement>('[data-pane="compat"]');
  const rows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>('.stims-editor__compat-row'),
    );

  const PROBLEM = [
    'title=T',
    'zoom=1.01',
    'bogus_field=3',
    'per_frame_1=q1 = notafunction(bass);',
  ].join('\n');

  test('lists each problem worst-first and counts them on the tab', () => {
    const panel = mount(PROBLEM);
    expect(rows(panel).map((row) => row.dataset.severity)).toEqual([
      'blocker',
      'ignored',
      // The compiler also reports that WebGPU falls back to WebGL for a
      // preset with unsupported pieces; it is listed last, without a line.
      'note',
    ]);
    expect(tab(panel)?.textContent).toBe('Compat · 3');
    expect(tab(panel)?.dataset.tone).toBe('danger');
    panel.dispose();
  });

  test('a clean preset says so and leaves the tab unbadged', () => {
    const panel = mount('title=T\nzoom=1.01\n');
    expect(rows(panel)).toHaveLength(0);
    expect(tab(panel)?.textContent).toBe('Compat');
    expect(panel.element.textContent).toContain('exactly');
    panel.dispose();
  });

  test('clicking a row puts the cursor on the line it points at', () => {
    const panel = mount(PROBLEM);
    const row = rows(panel).find((r) => r.dataset.severity === 'blocker');
    row?.click();
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
    expect(view.state.doc.lineAt(view.state.selection.main.from).number).toBe(
      4,
    );
    panel.dispose();
  });

  test('updates when the source changes', () => {
    const panel = mount(PROBLEM);
    const clean = 'title=T\nzoom=1.01\n';
    const compiled = compileMilkdropPresetSource(clean, { id: 'compat-ui2' });
    panel.setSessionState({
      source: clean,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: true,
    });
    expect(rows(panel)).toHaveLength(0);
    expect(tab(panel)?.textContent).toBe('Compat');
    panel.dispose();
  });
});
