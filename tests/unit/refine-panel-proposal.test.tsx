import { describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { RefinePanel } from '../../src/js/frontend/RefinePanel.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

const SOURCE = [
  'title=Alpha',
  'zoom=1.000',
  'rot=0.000',
  'wave_r=0.5',
  'per_frame_1=q1 = bass;',
].join('\n');

function mount(source = SOURCE) {
  const updateEditorSource = mock((_source: string) => {});
  // Held by reference: the harness hands this object to the panel, so
  // changing it and re-rendering is the running source moving on.
  const snapshot = { ...createEmptyEngineSnapshot(), currentSource: source };
  const rendered = renderWorkspace(<RefinePanel />, {
    engine: { updateEditorSource },
    snapshot,
  });
  const buttonNamed = (name: string) =>
    [...rendered.container.querySelectorAll('button')].find(
      (button) => button.textContent === name,
    );
  const clickAsync = async (name: string) => {
    await act(async () => {
      buttonNamed(name)?.click();
    });
  };
  return { rendered, snapshot, updateEditorSource, buttonNamed, clickAsync };
}

describe('Refine panel proposals', () => {
  test('a restyle is shown as a diff and applied only on Apply', async () => {
    const { rendered, updateEditorSource, clickAsync } = mount();
    try {
      await clickAsync('Neon');
      expect(updateEditorSource).not.toHaveBeenCalled();
      const diff = rendered.container.querySelector(
        '.stims-shell__refine-diff',
      );
      expect(
        diff?.querySelector('.stims-shell__refine-diff-line--add'),
      ).not.toBeNull();

      await clickAsync('Apply');
      expect(updateEditorSource).toHaveBeenCalledTimes(1);
      const applied = updateEditorSource.mock.calls[0]?.[0] ?? '';
      expect(applied).not.toBe(SOURCE);
      expect(
        rendered.container.querySelector('.stims-shell__refine-diff'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('Discard leaves the preset untouched', async () => {
    const { rendered, updateEditorSource, clickAsync } = mount();
    try {
      await clickAsync('Neon');
      await clickAsync('Discard');
      expect(updateEditorSource).not.toHaveBeenCalled();
      expect(
        rendered.container.querySelector('.stims-shell__refine-proposal'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('a proposal is not applied over a preset that changed since', async () => {
    const { rendered, snapshot, updateEditorSource, clickAsync } = mount();
    try {
      await clickAsync('Neon');
      // An edit (or another preset) lands while the proposal is open.
      snapshot.currentSource = `${SOURCE}\nwarp=0.4`;
      rendered.rerender(<RefinePanel />);
      await clickAsync('Apply');
      expect(updateEditorSource).not.toHaveBeenCalled();
      expect(rendered.text()).toContain('nothing was applied');
    } finally {
      rendered.dispose();
    }
  });
});
