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

/**
 * Toggles, mode pickers, ranges and modulation. Each of these replaced a
 * fader, so the thing worth asserting is that it writes the same field the
 * fader did — and, for modulation, that it edits the preset's code without
 * disturbing anything it did not author.
 */
describe('editor panel toggles, modes, ranges and modulation', () => {
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

  const open = (source: string) => {
    const panel = new EditorPanel(createMockCallbacks());
    panel.setSessionState(stateFor(source));
    return panel;
  };

  const toggleNamed = (panel: EditorPanel, label: string) =>
    [...panel.element.querySelectorAll('.stims-editor__toggle')].find(
      (node) => node.textContent === label,
    ) as HTMLButtonElement | undefined;

  test('a toggle reflects the preset through its long spelling', () => {
    const panel = open('bDarken=1\nbBrighten=0\n');

    expect(toggleNamed(panel, 'Darken')?.dataset.on).toBe('true');
    expect(toggleNamed(panel, 'Brighten')?.dataset.on).toBe('false');

    panel.dispose();
  });

  test('a toggle flips the field it owns', () => {
    const panel = open('bDarken=0\n');

    toggleNamed(panel, 'Darken')?.click();

    expect(panel.readVariableFromEditor('darken')).toBe(1);
    expect(toggleNamed(panel, 'Darken')?.dataset.on).toBe('true');

    toggleNamed(panel, 'Darken')?.click();
    expect(panel.readVariableFromEditor('darken')).toBe(0);

    panel.dispose();
  });

  test('a toggle falls back to the MilkDrop default, not to zero', () => {
    // texture_wrap and wave_brighten default to 1. Showing them as off would
    // misreport every preset that simply omits them.
    const panel = open('zoom=1.0\n');

    expect(toggleNamed(panel, 'Wrap edges')?.dataset.on).toBe('true');
    expect(toggleNamed(panel, 'Max wave colour')?.dataset.on).toBe('true');
    expect(toggleNamed(panel, 'Solarize')?.dataset.on).toBe('false');

    panel.dispose();
  });

  test('the wave mode picker selects the preset’s mode and writes a new one', () => {
    const panel = open('nWaveMode=3\n');

    const segments = [
      ...panel.element.querySelectorAll('.stims-editor__segment'),
    ] as HTMLButtonElement[];
    const selected = segments.filter((s) => s.dataset.on === 'true');
    expect(selected.map((s) => s.textContent)).toContain('Explosive');

    segments.find((s) => s.textContent === 'Line')?.click();
    expect(panel.readVariableFromEditor('wave_mode')).toBe(4);

    panel.dispose();
  });

  test('a range control writes both of its fields', () => {
    const panel = open('blur1_min=0\nblur1_max=1\n');

    // Targeted by label, not by position: sections are ordered by subject, so
    // the first range in the pane is the wave's volume fade, not a blur pass.
    const input = panel.element.querySelector(
      '.stims-editor__range-input[aria-label="Blur 1 lower bound"]',
    ) as HTMLInputElement;
    input.value = '0.4';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(panel.readVariableFromEditor('blur1_min')).toBeCloseTo(0.4, 3);
    expect(panel.readVariableFromEditor('blur1_max')).toBeCloseTo(1, 3);

    panel.dispose();
  });

  test('range handles sort themselves rather than sticking', () => {
    const panel = open('blur1_min=0\nblur1_max=1\n');

    // Drag the lower handle past the upper one.
    // Targeted by label, not by position: sections are ordered by subject, so
    // the first range in the pane is the wave's volume fade, not a blur pass.
    const input = panel.element.querySelector(
      '.stims-editor__range-input[aria-label="Blur 1 lower bound"]',
    ) as HTMLInputElement;
    input.value = '0.9';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const low = panel.readVariableFromEditor('blur1_min') ?? 0;
    const high = panel.readVariableFromEditor('blur1_max') ?? 0;
    expect(low).toBeLessThanOrEqual(high);

    panel.dispose();
  });

  test('turning on a modulation writes a per_frame equation', () => {
    const panel = open('zoom=1.2\n');

    const select = panel.element.querySelector(
      'select[aria-label="Zoom modulation source"]',
    ) as HTMLSelectElement;
    select.value = 'bass_att';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const source = panel.getEditorSource();
    expect(source).toContain('per_frame_1=zoom = 1.2');
    expect(source).toContain('bass_att');

    panel.dispose();
  });

  test('a modulation swings around the fader’s current value', () => {
    // Switching modulation on should not jump the preset to a new value.
    const panel = open('zoom=0.75\n');

    const select = panel.element.querySelector(
      'select[aria-label="Zoom modulation source"]',
    ) as HTMLSelectElement;
    select.value = 'treb_att';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(panel.getEditorSource()).toContain('zoom = 0.75');

    panel.dispose();
  });

  test('selecting "no modulation" removes the equation again', () => {
    const panel = open('zoom=1.2\nper_frame_1=zoom = 1.2 + 0.08*bass_att\n');

    const select = panel.element.querySelector(
      'select[aria-label="Zoom modulation source"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe('bass_att');

    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(panel.getEditorSource()).not.toContain('bass_att');

    panel.dispose();
  });

  test('a hand-written equation disables the control instead of rewriting it', () => {
    const panel = open(
      'zoom=1.0\nper_frame_1=zoom = 1.0 + 0.1*sin(time*0.7)*bass\n',
    );

    const select = panel.element.querySelector(
      'select[aria-label="Zoom modulation source"]',
    ) as HTMLSelectElement;
    const row = select.closest('.stims-editor__mod') as HTMLElement;

    expect(row.dataset.state).toBe('custom');
    expect(select.disabled).toBe(true);
    // And the preset's own code is still there, untouched.
    expect(panel.getEditorSource()).toContain('sin(time*0.7)');

    panel.dispose();
  });

  test('the modulation row reads back what the buffer holds', () => {
    const panel = open('per_frame_1=warp = 0.5*(1 + 0.4*mid_att)\n');

    const select = panel.element.querySelector(
      'select[aria-label="Warp modulation source"]',
    ) as HTMLSelectElement;
    const row = select.closest('.stims-editor__mod') as HTMLElement;
    const mode = row.querySelector(
      '.stims-editor__mod-mode',
    ) as HTMLButtonElement;

    expect(row.dataset.state).toBe('on');
    expect(select.value).toBe('mid_att');
    expect(mode.textContent).toBe('×');

    panel.dispose();
  });
});
