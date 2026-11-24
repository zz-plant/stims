import { expect, test } from 'bun:test';
import {
  buildCanvasInspectorHooks,
  subscribeEditorReveal,
  takeEditorReveal,
} from '../../src/js/frontend/editor-reveal.ts';

test('Edit code queues one reveal, opens the editor and says so', () => {
  const opened: string[] = [];
  const said: string[] = [];
  let heard = 0;
  const unsubscribe = subscribeEditorReveal(() => {
    heard += 1;
  });
  const hooks = buildCanvasInspectorHooks({
    openEditor: () => opened.push('editor'),
    announce: (message) => said.push(message),
    readBase: () => 1,
    setLive: () => {},
  });
  hooks.editCode?.('warp');
  expect(heard).toBe(1);
  expect(opened).toEqual(['editor']);
  expect(said).toEqual(['Opening the editor at warp.']);
  expect(takeEditorReveal()).toBe('warp');
  // Taken once: a later editor mount does not jump again.
  expect(takeEditorReveal()).toBeNull();
  unsubscribe();
});
