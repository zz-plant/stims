import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  computeAstDiagnostics,
  DEFAULT_EDITOR_COLOR_GROUPS,
  DEFAULT_EDITOR_SLIDERS,
  EditorPanel,
  type EditorPanelCallbacks,
  mergeDiagnostics,
} from '../../src/js/milkdrop/overlay/editor-panel.ts';
import type {
  MilkdropDiagnostic,
  MilkdropEditorSessionState,
  MilkdropPresetSource,
} from '../../src/js/milkdrop/types.ts';

describe('editor panel AST diagnostics & helpers', () => {
  test('computeAstDiagnostics returns no errors for clean EEL preset source', () => {
    const validSource = [
      '[preset]',
      'zoom=1.01',
      'warp=0.05',
      'rot=0.0',
      'per_frame=wave_r = 0.5 + 0.35*sin(time*0.31);',
    ].join('\n');

    const diagnostics = computeAstDiagnostics(validSource);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(0);
  });

  test('computeAstDiagnostics detects unclosed parenthesis on EEL equations', () => {
    const sourceWithParenError = [
      '[preset]',
      'zoom=1.01',
      'per_frame=wave_r = 0.5 + 0.35*sin(time*0.31;',
    ].join('\n');

    const diagnostics = computeAstDiagnostics(sourceWithParenError);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code === 'unclosed_paren')).toBe(true);
    expect(errors.some((e) => e.line === 3)).toBe(true);
  });

  test('computeAstDiagnostics detects unmatched closing parenthesis', () => {
    const sourceWithExtraClosing = ['[preset]', 'zoom=1.01 + 0.05)'].join('\n');

    const diagnostics = computeAstDiagnostics(sourceWithExtraClosing);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.code === 'unmatched_closing_paren')).toBe(true);
  });

  test('mergeDiagnostics combines and deduplicates diagnostics', () => {
    const primary: MilkdropDiagnostic[] = [
      {
        severity: 'error',
        code: 'err_1',
        message: 'Syntax error at line 2',
        line: 2,
      },
    ];
    const secondary: MilkdropDiagnostic[] = [
      {
        severity: 'error',
        code: 'err_1',
        message: 'Syntax error at line 2',
        line: 2,
      },
      { severity: 'warning', code: 'warn_1', message: 'Ignored line', line: 4 },
    ];

    const merged = mergeDiagnostics(primary, secondary);
    expect(merged.length).toBe(2);
    expect(merged[0].code).toBe('err_1');
    expect(merged[1].code).toBe('warn_1');
  });

  test('DEFAULT_EDITOR_SLIDERS contains expected Milkdrop parameters', () => {
    const keys = DEFAULT_EDITOR_SLIDERS.map((s) => s.key);
    expect(keys).toContain('zoom');
    expect(keys).toContain('warp');
    expect(keys).toContain('rot');
    expect(keys).toContain('decay');
    expect(keys).toContain('cx');
    expect(keys).toContain('cy');
    expect(keys).toContain('sx');
    expect(keys).toContain('sy');
    expect(keys).toContain('dx');
    expect(keys).toContain('dy');
    expect(keys).toContain('ob_size');
    // wave_a is not a fader any more: it is the alpha half of the Wave colour
    // group, so the swatch and its alpha move together.
    expect(keys).not.toContain('wave_a');
    // Booleans, enums and range pairs moved to their own control types.
    expect(keys).not.toContain('brighten');
    expect(keys).not.toContain('wave_mode');
    expect(keys).not.toContain('blur1_min');
  });

  test('DEFAULT_EDITOR_COLOR_GROUPS covers every r/g/b block in the format', () => {
    const channels = DEFAULT_EDITOR_COLOR_GROUPS.flatMap((group) => group.rgb);
    expect(channels).toContain('bg_r');
    expect(channels).toContain('wave_r');
    expect(channels).toContain('mv_r');
    expect(channels).toContain('ob_r');
    expect(channels).toContain('ib_r');
    expect(channels).toContain('mesh_r');

    // MilkDrop is not consistent about the alpha suffix; the group has to
    // carry the real field name or the control writes to nothing.
    const waveGroup = DEFAULT_EDITOR_COLOR_GROUPS.find(
      (group) => group.label === 'Wave',
    );
    expect(waveGroup?.alpha?.key).toBe('wave_a');
    const meshGroup = DEFAULT_EDITOR_COLOR_GROUPS.find(
      (group) => group.label === 'Solid mesh',
    );
    expect(meshGroup?.alpha?.key).toBe('mesh_alpha');
  });
});

describe('EditorPanel class integration', () => {
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

  test('instantiates EditorPanel DOM elements correctly', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    expect(panel.element).toBeDefined();
    expect(panel.element.className).toContain('stims-editor');

    const slidersRegion = panel.element.querySelector('.stims-editor__sliders');
    expect(slidersRegion).not.toBeNull();

    const diagnosticsContainer = panel.element.querySelector(
      '.stims-editor__problems-list',
    );
    expect(diagnosticsContainer).not.toBeNull();

    panel.dispose();
  });

  test('reads and updates variables in editor source correctly', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const initialState: MilkdropEditorSessionState = {
      source: 'zoom=1.05\nwarp=0.20\nrot=0.00\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    };
    panel.setSessionState(initialState);

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.05, 2);
    expect(panel.readVariableFromEditor('warp')).toBeCloseTo(0.2, 2);

    // Update existing variable
    panel.writeVariableToEditor('zoom', 1.45);
    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.45, 2);
    expect(callbacks.onEditorSourceChange).toHaveBeenCalledWith(
      expect.stringContaining('zoom=1.45'),
    );

    // Append missing variable
    panel.writeVariableToEditor('dx', 0.15);
    expect(panel.readVariableFromEditor('dx')).toBeCloseTo(0.15, 2);
    expect(panel.getEditorSource()).toContain('dx=0.15');

    panel.dispose();
  });

  test('displays compile error indicators when session state has diagnostics', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const errorState: MilkdropEditorSessionState = {
      source: 'zoom=1.0\nper_frame=bad_func(\n',
      diagnostics: [
        {
          severity: 'error',
          code: 'unclosed_paren',
          message: "Unclosed parenthesis '(' at line 2.",
          line: 2,
        },
      ],
      latestCompiled: null,
      activeCompiled: null,
      dirty: true,
    };

    panel.setSessionState(errorState);

    const statusEl = panel.element.querySelector(
      '.stims-editor__note',
    ) as HTMLElement;
    expect(statusEl).not.toBeNull();
    expect(statusEl.textContent).toContain('error');
    expect(statusEl.classList.contains('stims-editor__note--error')).toBe(true);
    expect(statusEl.hidden).toBe(false);

    const stateEl = panel.element.querySelector(
      '.stims-editor__state',
    ) as HTMLElement;
    expect(stateEl.dataset.state).toBe('error');
    expect(stateEl.textContent).toContain('Holding last good frame');

    const problemsCount = panel.element.querySelector(
      '.stims-editor__count',
    ) as HTMLElement;
    expect(problemsCount.dataset.tone).toBe('danger');
    expect(problemsCount.textContent).toMatch(/^\d+ err · \d+ warn$/u);

    // The safety flag reports fidelity degradation only; a plain compile
    // error is already covered by the state label and the problems count.
    const safetyBadge = panel.element.querySelector(
      '.stims-editor__flag--safety',
    ) as HTMLElement;
    expect(safetyBadge).not.toBeNull();
    expect(safetyBadge.hidden).toBe(true);

    const diagItem = panel.element.querySelector(
      '.stims-editor__problem--error',
    );
    expect(diagItem).not.toBeNull();
    expect(diagItem?.textContent).toContain('Line 2');
    expect(diagItem?.textContent).toContain('Unclosed parenthesis');

    const quickFixBtn = panel.element.querySelector(
      '.stims-editor__fix',
    ) as HTMLElement;
    expect(quickFixBtn).not.toBeNull();
    expect(quickFixBtn.style.display).not.toBe('none');

    panel.dispose();
  });

  test('slider double click resets parameter to default value', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    panel.setSessionState({
      source: 'zoom=2.500\n',
      diagnostics: [],
      latestCompiled: null,
      activeCompiled: null,
      dirty: false,
    });

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(2.5, 2);

    const zoomLabel = Array.from(
      panel.element.querySelectorAll<HTMLLabelElement>(
        '.stims-editor__slider-label',
      ),
    ).find((el) => el.textContent === 'Zoom');

    expect(zoomLabel).toBeDefined();

    const event =
      typeof MouseEvent !== 'undefined'
        ? new MouseEvent('dblclick', { bubbles: true })
        : new Event('dblclick', { bubbles: true });

    zoomLabel?.dispatchEvent(event);

    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(1.0, 2);
    expect(panel.getEditorSource()).toContain('zoom=1\n');

    panel.dispose();
  });

  const sessionStateFor = (
    raw: string,
    source: Partial<MilkdropPresetSource>,
  ): MilkdropEditorSessionState => {
    const compiled = compileMilkdropPresetSource(raw, source);
    return {
      source: compiled.formattedSource,
      diagnostics: compiled.diagnostics,
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    };
  };

  test('an unsaved draft survives session echoes of the same preset', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    const preset = sessionStateFor('title=Draft Preset\nzoom=1.050\n', {
      id: 'draft-preset',
      title: 'Draft Preset',
      origin: 'user',
    });
    panel.setSessionState(preset);
    panel.writeVariableToEditor('zoom', 1.9);
    expect(panel.getEditorSource()).toContain('zoom=1.9');

    // The compile of an *older* keystroke lands late. It must not yank the
    // buffer out from under the newer draft.
    panel.setSessionState(preset);
    expect(panel.getEditorSource()).toContain('zoom=1.9');

    panel.dispose();
  });

  test('switching presets replaces a buffered draft rather than stranding it', () => {
    const callbacks = createMockCallbacks();
    const panel = new EditorPanel(callbacks);

    panel.setSessionState(
      sessionStateFor('title=Preset A\nzoom=1.050\n', {
        id: 'preset-a',
        title: 'Preset A',
        origin: 'user',
      }),
    );

    // Unsaved local draft belonging to preset A.
    panel.writeVariableToEditor('zoom', 1.9);
    expect(panel.getEditorSource()).toContain('zoom=1.9');

    panel.setSessionState(
      sessionStateFor('title=Preset B\nzoom=0.500\n', {
        id: 'preset-b',
        title: 'Preset B',
        origin: 'bundled',
      }),
    );

    // Holding on to A's draft would leave the editor showing one preset while
    // another renders — and the next keystroke would commit A's text as B.
    expect(panel.getEditorSource()).toContain('Preset B');
    expect(panel.getEditorSource()).not.toContain('Preset A');
    expect(panel.readVariableFromEditor('zoom')).toBeCloseTo(0.5, 2);

    panel.dispose();
  });

  /**
   * AI edits never replace the buffer directly — they arrive as a reviewable
   * diff. The whole safety of that flow rests on Apply re-checking that the
   * buffer has not moved since the diff was computed, because the proposal
   * replaces the document wholesale.
   */
  describe('assisted-edit proposals', () => {
    const PROPOSED = 'title=Proposed\nzoom=2.000\nwarp=0.900\n';

    async function openProposal(panel: EditorPanel, seed: string) {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ milkSource: PROPOSED }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch;

      panel.setSessionState({
        source: seed,
        diagnostics: [],
        latestCompiled: null,
        activeCompiled: null,
        dirty: false,
      });

      const input = panel.element.querySelector<HTMLInputElement>(
        '.stims-editor__assist-input',
      );
      const refine = Array.from(
        panel.element.querySelectorAll<HTMLButtonElement>('button'),
      ).find((b) => b.textContent === 'Refine');
      if (!input || !refine) throw new Error('assist controls not rendered');

      input.value = 'make it bluer';
      refine.click();
      // Let the stubbed fetch and its two await points settle.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      globalThis.fetch = originalFetch;

      return Array.from(
        panel.element.querySelectorAll<HTMLButtonElement>('button'),
      ).find((b) => b.textContent === 'Apply');
    }

    test('applies a proposal when the buffer has not moved', async () => {
      const callbacks = createMockCallbacks();
      const panel = new EditorPanel(callbacks);

      const apply = await openProposal(panel, 'title=Seed\nzoom=1.000\n');
      expect(apply).toBeDefined();

      apply?.click();

      expect(panel.getEditorSource()).toContain('zoom=2.000');
      expect(callbacks.onEditorSourceChange).toHaveBeenCalledWith(PROPOSED);

      panel.dispose();
    });

    test('refuses a proposal whose base source changed underneath it', async () => {
      const callbacks = createMockCallbacks();
      const panel = new EditorPanel(callbacks);

      const apply = await openProposal(panel, 'title=Seed\nzoom=1.000\n');
      expect(apply).toBeDefined();

      // A knob turn (or a keystroke) lands while the diff sits open. The
      // proposal was computed against the old text and would silently discard
      // this edit if it still applied.
      panel.writeVariableToEditor('zoom', 1.45);
      const beforeApply = panel.getEditorSource();

      apply?.click();

      expect(panel.getEditorSource()).toBe(beforeApply);
      expect(panel.getEditorSource()).not.toContain('zoom=2.000');
      expect(callbacks.onEditorSourceChange).not.toHaveBeenCalledWith(PROPOSED);
      expect(panel.element.textContent).toContain('the source changed');

      panel.dispose();
    });
  });

  describe('A/B snapshot and comparison', () => {
    test('takes snapshot and toggles between Slot A and Slot B', () => {
      const callbacks = createMockCallbacks();
      const panel = new EditorPanel(callbacks);

      panel.setSessionState({
        source: 'title=Original\nzoom=1.000\n',
        diagnostics: [],
        latestCompiled: null,
        activeCompiled: null,
        dirty: false,
      });

      // Snapshot current doc as Slot A
      panel.snapshotSlotA();
      expect(panel.getSnapshotState().slot).toBe('A');
      expect(panel.getSnapshotState().sourceA).toContain('zoom=1.000');

      // Edit doc for Slot B
      panel.writeVariableToEditor('zoom', 1.5);
      panel.snapshotSlotB();
      expect(panel.getSnapshotState().slot).toBe('B');
      expect(panel.getSnapshotState().sourceB).toContain('zoom=1.5');

      // Toggle back to Slot A
      panel.toggleAbSnapshot();
      expect(panel.getSnapshotState().slot).toBe('A');
      expect(panel.getEditorSource()).toContain('zoom=1.000');

      // Toggle forward to Slot B
      panel.toggleAbSnapshot();
      expect(panel.getSnapshotState().slot).toBe('B');
      expect(panel.getEditorSource()).toContain('zoom=1.5');

      // Clear snapshots
      panel.clearSnapshots();
      expect(panel.getSnapshotState().sourceA).toBeNull();
      expect(panel.getSnapshotState().sourceB).toBeNull();

      panel.dispose();
    });
  });
});
