import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

/**
 * Preset parameters in the Tune tab: the knob must drive the running preset
 * live, write the new literal into its own line, and survive the source
 * update its own edit causes.
 */
describe('editor panel preset parameter knobs', () => {
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
    'per_frame_init_1=speed = 1.5; beat = 0;',
    'per_frame_1=rot = rot + speed*0.01; beat = above(bass, 1);',
  ].join('\n');

  const mount = (source: string) => {
    const onLiveFieldChange = mock((_key: string, _value: number) => {});
    const onEditorSourceChange = mock((_source: string) => {});
    const panel = new EditorPanel({
      onEditorSourceChange,
      onLiveFieldChange,
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
    });
    document.body.appendChild(panel.element);
    const setSource = (next: string) =>
      panel.setSessionState({
        source: next,
        diagnostics: [],
        latestCompiled: null,
        activeCompiled: null,
        dirty: false,
      });
    setSource(source);
    return { panel, onLiveFieldChange, onEditorSourceChange, setSource };
  };
  const knobs = (panel: EditorPanel) =>
    Array.from(panel.element.querySelectorAll<HTMLElement>('[data-knob]')).map(
      (row) => row.dataset.knob,
    );
  const section = (panel: EditorPanel) =>
    panel.element.querySelector<HTMLElement>('[data-section="knobs"]');

  test('lists the preset parameter and not its state variables', () => {
    const { panel } = mount(SOURCE);
    expect(section(panel)?.hidden).toBe(false);
    expect(knobs(panel)).toEqual(['speed']);
    panel.dispose();
  });

  test('a preset without parameters shows no section', () => {
    const { panel } = mount('title=T\nzoom=1.01\n');
    expect(section(panel)?.hidden).toBe(true);
    panel.dispose();
  });

  test('moving a knob applies live and rewrites only that literal', async () => {
    const { panel, onLiveFieldChange, onEditorSourceChange, setSource } =
      mount(SOURCE);
    const input = panel.element.querySelector<HTMLInputElement>(
      '[data-knob="speed"] input',
    ) as HTMLInputElement;
    input.value = '2.25';
    input.dispatchEvent(new Event('input'));

    expect(onLiveFieldChange).toHaveBeenLastCalledWith('speed', 2.25);
    expect(panel.getEditorSource().split('\n')[1]).toBe(
      'per_frame_init_1=speed = 2.25; beat = 0;',
    );
    // The edit is committed to the engine, not left sitting in the buffer.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onEditorSourceChange).toHaveBeenLastCalledWith(
      panel.getEditorSource(),
    );

    // The edit comes back as a new session state; the same slider element
    // must still be there (not rebuilt out from under a drag).
    setSource(panel.getEditorSource());
    // Compare identity as a boolean: a failing toBe on two DOM elements makes
    // the reporter serialise the whole tree, which hangs instead of failing.
    const after = panel.element.querySelector('[data-knob="speed"] input');
    expect(after === input).toBe(true);
    panel.dispose();
  });

  test('editing the literal in code moves the knob', () => {
    const { panel, setSource } = mount(SOURCE);
    setSource(SOURCE.replace('speed = 1.5', 'speed = 0.5'));
    const input = panel.element.querySelector<HTMLInputElement>(
      '[data-knob="speed"] input',
    );
    expect(Number(input?.value)).toBeCloseTo(0.5, 5);
    panel.dispose();
  });
});
