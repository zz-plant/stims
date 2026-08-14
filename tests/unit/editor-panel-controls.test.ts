import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import {
  EditorPanel,
  type EditorPanelCallbacks,
} from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';

/**
 * The Tune pane's non-fader controls. A MilkDrop colour is three or four
 * unrelated scalars and any field can be either a literal the buffer owns or
 * a value the preset's own equations rewrite every frame — these controls
 * only help if they collapse the first and report the second.
 */
describe('editor panel colour groups and value-source chips', () => {
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

  const createMockCallbacks = (): EditorPanelCallbacks => ({
    onEditorSourceChange: mock(() => {}),
    onRevertToActive: mock(() => {}),
    onDuplicatePreset: mock(() => {}),
    onExport: mock(() => {}),
    onDeletePreset: mock(() => {}),
    onRequestImport: mock(() => {}),
  });

  const stateFor = (source: string): MilkdropEditorSessionState => ({
    source,
    diagnostics: [],
    latestCompiled: null,
    activeCompiled: null,
    dirty: false,
  });

  const swatchFor = (panel: EditorPanel, label: string) => {
    const rows = Array.from(
      panel.element.querySelectorAll('.stims-editor__color'),
    );
    const row = rows.find(
      (candidate) =>
        candidate.querySelector('.stims-editor__slider-label')?.textContent ===
        label,
    );
    return row?.querySelector(
      '.stims-editor__color-swatch',
    ) as HTMLInputElement | null;
  };

  const chipFor = (panel: EditorPanel, label: string) => {
    const heads = Array.from(
      panel.element.querySelectorAll('.stims-editor__control-head'),
    );
    const head = heads.find(
      (candidate) =>
        candidate.querySelector('.stims-editor__slider-label')?.textContent ===
        label,
    );
    return head?.querySelector(
      '.stims-editor__state-chip',
    ) as HTMLButtonElement | null;
  };

  test('a swatch reflects the preset it was handed, through alias spellings', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(
      stateFor('fOuterBorderR=1.0\nfOuterBorderG=0.0\nfOuterBorderB=0.0\n'),
    );

    expect(swatchFor(panel, 'Outer border')?.value).toBe('#ff0000');

    panel.dispose();
  });

  test('moving a swatch writes all three channels in one edit', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);
    panel.setSessionState(stateFor('bg_r=0\nbg_g=0\nbg_b=0\n'));

    const swatch = swatchFor(panel, 'Background');
    expect(swatch).not.toBeNull();
    if (!swatch) return;

    swatch.value = '#3366ff';
    swatch.dispatchEvent(new Event('input', { bubbles: true }));

    expect(panel.readVariableFromEditor('bg_r')).toBeCloseTo(0x33 / 255, 3);
    expect(panel.readVariableFromEditor('bg_g')).toBeCloseTo(0x66 / 255, 3);
    expect(panel.readVariableFromEditor('bg_b')).toBeCloseTo(1, 3);

    // One transaction, not three: a swatch drag would otherwise queue a
    // recompile per channel.
    expect(callbacks.onEditorSourceChange).toHaveBeenCalledTimes(1);

    panel.dispose();
  });

  test('a swatch writes the spelling the preset already uses', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(
      stateFor('fOuterBorderR=0.0\nfOuterBorderG=0.0\nfOuterBorderB=0.0\n'),
    );

    const swatch = swatchFor(panel, 'Outer border');
    if (!swatch) throw new Error('missing outer border swatch');
    swatch.value = '#ffffff';
    swatch.dispatchEvent(new Event('input', { bubbles: true }));

    const source = panel.getEditorSource();
    expect(source).toContain('fOuterBorderR=1');
    expect(source).not.toContain('ob_r=');

    panel.dispose();
  });

  test('the chip says "set" when the buffer owns the value', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(stateFor('zoom=1.02\n'));

    const chip = chipFor(panel, 'Zoom');
    expect(chip?.dataset.state).toBe('static');
    expect(chip?.textContent).toBe('set');
    // Nothing to jump to.
    expect(chip?.disabled).toBe(true);

    panel.dispose();
  });

  test('the chip says "eq" when the preset recomputes the field each frame', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(
      stateFor('zoom=1.02\nper_frame_1=zoom = 1.0 + bass*0.1;\n'),
    );

    const chip = chipFor(panel, 'Zoom');
    expect(chip?.dataset.state).toBe('driven');
    expect(chip?.textContent).toBe('eq');
    // Clickable, because there is an equation line to jump to.
    expect(chip?.disabled).toBe(false);
    expect(chip?.title).toContain('overwritten');

    panel.dispose();
  });

  test('a colour group reports driven when any one of its channels is', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(
      stateFor(
        'wave_r=1\nwave_g=1\nwave_b=1\nper_frame_1=wave_b = sin(time);\n',
      ),
    );

    expect(chipFor(panel, 'Wave')?.dataset.state).toBe('driven');

    panel.dispose();
  });

  test('the chip follows the buffer as the source changes', () => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(stateFor('rot=0.1\n'));
    expect(chipFor(panel, 'Rot')?.dataset.state).toBe('static');

    panel.setSessionState(stateFor('rot=0.1\nper_frame_1=rot = time*0.01;\n'));
    expect(chipFor(panel, 'Rot')?.dataset.state).toBe('driven');

    panel.dispose();
  });
});
