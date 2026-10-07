import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import { publishVariables } from '../../src/js/milkdrop/variable-probe.ts';

/**
 * The Inspect tab is the answer to "what are my equations actually doing".
 * It must show live values only while it is the visible tab, and a pin must
 * survive the rapid repaint that would otherwise eat a click.
 */
describe('editor panel Inspect tab', () => {
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

  const mount = () => {
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
    });
    document.body.appendChild(panel.element);
    return panel;
  };
  const openInspect = (panel: EditorPanel) =>
    panel.element
      .querySelector<HTMLButtonElement>('[data-pane="inspect"]')
      ?.click();
  // Painting is throttled while frames stream in; typing in the filter forces
  // an immediate repaint so assertions read current state, not a stale frame.
  const repaint = (panel: EditorPanel) =>
    panel.element
      .querySelector('.stims-editor__inspect-filter')
      ?.dispatchEvent(new Event('input'));
  const rowNames = (panel: EditorPanel) => {
    repaint(panel);
    return Array.from(
      panel.element.querySelectorAll('.stims-editor__inspect-row'),
    ).map((row) => (row as HTMLElement).dataset.name);
  };

  test('lists published variables, q-vars first, once the tab is open', () => {
    const panel = mount();
    publishVariables({ zoom: 1, q2: 0.5, q1: 0.25 });
    expect(rowNames(panel)).toEqual([]);

    openInspect(panel);
    publishVariables({ zoom: 1, q2: 0.5, q1: 0.25 });
    expect(rowNames(panel)).toEqual(['q1', 'q2', 'zoom']);
    panel.dispose();
  });

  test('stops listening when another tab is selected', () => {
    const panel = mount();
    openInspect(panel);
    publishVariables({ a: 1 });
    panel.element
      .querySelector<HTMLButtonElement>('[data-pane="tune"]')
      ?.click();
    publishVariables({ a: 1, b: 2 });
    openInspect(panel);
    // `b` arrived while hidden, so it was never recorded.
    expect(rowNames(panel)).toEqual(['a']);
    panel.dispose();
  });

  test('pinning floats a variable to the top', () => {
    const panel = mount();
    openInspect(panel);
    publishVariables({ q1: 0, zoom: 1 });
    const pin = panel.element.querySelector<HTMLElement>('[data-pin="zoom"]');
    pin?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(rowNames(panel)[0]).toBe('zoom');
    panel.dispose();
  });
});
