import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import type { VersionStorage } from '../../src/js/milkdrop/named-versions.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';

/**
 * Named versions are the author's own bookmarks: they must survive a reload,
 * belong to one preset, diff against the buffer, and restore without losing
 * what was there.
 */
describe('editor panel named versions', () => {
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

  const memoryStorage = (): VersionStorage => {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
  };

  // The compiler caches by source text, so identical text in another test file
  // would come back under that file's preset id. Every test gets its own text.
  let counter = 0;
  const sources = () => {
    counter += 1;
    const id = `versions-test-${counter}`;
    return {
      id,
      v1: `title=${id}\nzoom=1.01\n`,
      v2: `title=${id}\nzoom=1.05\nrot=0.1\n`,
    };
  };

  const newPanel = (storage: VersionStorage | null) => {
    const onEditorSourceChange = mock(() => {});
    const panel = new EditorPanel(
      {
        onEditorSourceChange,
        onRevertToActive: mock(() => {}),
        onDuplicatePreset: mock(() => {}),
        onExport: mock(() => {}),
        onDeletePreset: mock(() => {}),
        onRequestImport: mock(() => {}),
        onCopyShareLink: mock(() => {}),
      },
      { versionStorage: storage },
    );
    document.body.appendChild(panel.element);
    return { panel, onEditorSourceChange };
  };
  const load = (panel: EditorPanel, source: string, id: string) => {
    const compiled = compileMilkdropPresetSource(source, { id });
    panel.setSessionState({
      source,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
  };
  const mount = (storage: VersionStorage | null) => {
    const src = sources();
    const made = newPanel(storage);
    load(made.panel, src.v1, src.id);
    return { ...made, src };
  };
  const save = (panel: EditorPanel, name: string) => {
    const input = panel.element.querySelector<HTMLInputElement>(
      '.stims-editor__version-name',
    );
    if (!input) throw new Error('no name input');
    input.value = name;
    Array.from(panel.element.querySelectorAll('button'))
      .find((b) => b.textContent === 'Save version')
      ?.click();
  };
  const versionRows = (panel: EditorPanel) =>
    Array.from(
      panel.element.querySelectorAll<HTMLElement>('.stims-editor__version'),
    );
  const button = (root: ParentNode, label: string) =>
    Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;

  test('a saved version survives a reload and belongs to its preset', () => {
    const storage = memoryStorage();
    const first = mount(storage);
    save(first.panel, 'before the warp');
    expect(versionRows(first.panel)).toHaveLength(1);
    first.panel.dispose();

    const reloaded = newPanel(storage);
    load(reloaded.panel, first.src.v1, first.src.id);
    expect(versionRows(reloaded.panel)).toHaveLength(1);
    expect(versionRows(reloaded.panel)[0]?.textContent).toContain(
      'before the warp',
    );

    const other = sources();
    load(reloaded.panel, other.v1, other.id);
    expect(versionRows(reloaded.panel)).toHaveLength(0);
    reloaded.panel.dispose();
  });

  test('Compare shows what changed since the version, and says when nothing did', () => {
    const { panel, src } = mount(memoryStorage());
    save(panel, 'v1');
    const row = versionRows(panel)[0] as HTMLElement;

    button(row, 'Compare').click();
    expect(row.textContent).toContain('Identical to the current source');
    button(row, 'Compare').click();

    load(panel, src.v2, src.id);
    button(versionRows(panel)[0] as HTMLElement, 'Compare').click();
    const diff = panel.element.querySelector('[data-version-diff]');
    expect(diff?.textContent).toContain('- zoom=1.01');
    expect(diff?.textContent).toContain('+ zoom=1.05');
    expect(diff?.textContent).toContain('+ rot=0.1');
    panel.dispose();
  });

  test('Restore brings the version back and checkpoints what it replaced', () => {
    const { panel, onEditorSourceChange, src } = mount(memoryStorage());
    save(panel, 'v1');
    load(panel, src.v2, src.id);

    button(versionRows(panel)[0] as HTMLElement, 'Restore').click();

    expect(panel.getEditorSource()).toBe(src.v1);
    expect(onEditorSourceChange).toHaveBeenCalledWith(src.v1);
    // The edit that was replaced is recoverable from the automatic checkpoints.
    const history = panel.element.querySelector('.stims-editor__history');
    expect(history?.textContent).toContain('Before restore');
    panel.dispose();
  });

  test('Delete removes just that version', () => {
    const { panel } = mount(memoryStorage());
    save(panel, 'keep');
    save(panel, 'drop');
    const drop = versionRows(panel).find((r) =>
      r.textContent?.includes('drop'),
    );
    button(drop as HTMLElement, 'Delete').click();
    expect(versionRows(panel).map((r) => r.textContent)).toEqual([
      expect.stringContaining('keep'),
    ]);
    panel.dispose();
  });

  test('blocked storage says so instead of throwing', () => {
    const { panel } = mount(null);
    save(panel, 'x');
    expect(panel.element.textContent).toContain('Could not save');
    expect(versionRows(panel)).toHaveLength(0);
    panel.dispose();
  });

  test('Save is disabled until a preset is open', () => {
    const { panel } = newPanel(memoryStorage());
    expect(button(panel.element, 'Save version').disabled).toBe(true);
    panel.dispose();
  });
});
