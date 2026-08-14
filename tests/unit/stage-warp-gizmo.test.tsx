import { describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { StageWarpGizmo } from '../../src/js/frontend/StageWarpGizmo.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

/**
 * cx/cy is the point the warp turns around, so the honest control for it is
 * the point itself on the stage. These assertions cover the parts that can be
 * wrong without anything throwing: where the handle lands for a given preset,
 * what it writes back, and whether it admits when the preset's own equations
 * are the ones actually deciding the centre.
 */
describe('StageWarpGizmo', () => {
  const render = (
    source: string | null,
    options: { panel?: 'editor' | 'browse'; onSource?: (next: string) => void },
  ) =>
    renderWorkspace(createElement(StageWarpGizmo), {
      ui: {
        routeState: {
          presetId: null,
          collectionTag: null,
          panel: options.panel ?? 'editor',
          audioSource: null,
          agentMode: false,
        },
      },
      engine: { updateEditorSource: options.onSource ?? (() => {}) },
      snapshot:
        source === null
          ? createEmptyEngineSnapshot()
          : {
              ...createEmptyEngineSnapshot(),
              sessionState: {
                source,
                latestCompiled: null,
                activeCompiled: null,
                diagnostics: [],
                dirty: false,
              },
            },
    });

  const handleOf = (container: Element) =>
    container.querySelector<HTMLElement>('.stims-stage-gizmo__handle');

  /** The test DOM has no KeyboardEvent constructor, and React reads `key` and
   * `shiftKey` straight off the native event, so a plain Event carrying them
   * exercises the same handler. */
  const press = (
    target: HTMLElement | null,
    key: string,
    modifiers: { shiftKey?: boolean } = {},
  ) => {
    if (!target) throw new Error('press: no handle');
    const event = Object.assign(new Event('keydown', { bubbles: true }), {
      key,
      shiftKey: modifiers.shiftKey ?? false,
    });
    act(() => {
      target.dispatchEvent(event);
    });
  };

  test('is absent unless the editor is the open panel', () => {
    const rendered = render('cx=0.5\ncy=0.5\n', { panel: 'browse' });
    expect(handleOf(rendered.container)).toBeNull();
    rendered.dispose();
  });

  test('is absent when there is no editor session to write to', () => {
    const rendered = render(null, {});
    expect(handleOf(rendered.container)).toBeNull();
    rendered.dispose();
  });

  test('sits at the preset centre, reading through alias spellings', () => {
    const rendered = render('fCX=0.25\nfCY=0.75\n', {});
    const handle = handleOf(rendered.container);

    expect(handle?.style.left).toBe('25%');
    expect(handle?.style.top).toBe('75%');

    rendered.dispose();
  });

  test('falls back to the MilkDrop default centre when the preset omits it', () => {
    const rendered = render('zoom=1.0\n', {});
    const handle = handleOf(rendered.container);

    expect(handle?.style.left).toBe('50%');
    expect(handle?.style.top).toBe('50%');

    rendered.dispose();
  });

  test('arrow keys nudge the centre and write both fields', () => {
    const writes: string[] = [];
    const rendered = render('cx=0.5\ncy=0.5\n', {
      onSource: (next) => writes.push(next),
    });

    const handle = handleOf(rendered.container);
    expect(handle).not.toBeNull();
    press(handle, 'ArrowRight');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('cx=0.505');
    expect(writes[0]).toContain('cy=0.5');

    rendered.dispose();
  });

  test('Shift makes the nudge coarse', () => {
    const writes: string[] = [];
    const rendered = render('cx=0.5\ncy=0.5\n', {
      onSource: (next) => writes.push(next),
    });

    press(handleOf(rendered.container), 'ArrowDown', { shiftKey: true });

    expect(writes[0]).toContain('cy=0.55');

    rendered.dispose();
  });

  test('the centre stays inside the frame', () => {
    const writes: string[] = [];
    const rendered = render('cx=0\ncy=0\n', {
      onSource: (next) => writes.push(next),
    });

    press(handleOf(rendered.container), 'ArrowLeft');

    // Already at the edge: nothing to write, so no recompile is queued.
    expect(writes).toHaveLength(0);

    rendered.dispose();
  });

  test('flags itself when the preset recomputes the centre every frame', () => {
    const rendered = render(
      'cx=0.5\ncy=0.5\nper_frame_1=cx = 0.5 + sin(time);\n',
      {},
    );
    const handle = handleOf(rendered.container);

    expect(handle?.dataset.driven).toBe('true');
    // The marker is showing the literal in the draft, which is not where the
    // warp is actually centred — saying so is the whole point of the flag.
    expect(handle?.textContent).toContain('eq');
    expect(handle?.getAttribute('aria-label')).toContain('every frame');

    rendered.dispose();
  });

  test('reads as a plain draggable marker when nothing overrides it', () => {
    const rendered = render('cx=0.4\ncy=0.6\n', {});
    const handle = handleOf(rendered.container);

    expect(handle?.dataset.driven).toBeUndefined();
    expect(handle?.textContent).toContain('0.40, 0.60');

    rendered.dispose();
  });
});
