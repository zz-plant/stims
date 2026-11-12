/**
 * With nothing pinned the live sliders stay off the stage until someone asks
 * for the picker from the dock menu or the palette.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { PerformSurface } from '../../src/js/frontend/PerformSurface.tsx';
import {
  getPinnedTargets,
  openPerformPicker,
  unpinTarget,
} from '../../src/js/frontend/perform-pins.ts';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
  for (const target of [...getPinnedTargets()]) unpinTarget(target);
});

test('nothing pinned puts nothing on the stage', () => {
  view = renderWorkspace(createElement(PerformSurface));
  expect(view.container.querySelector('aside')).toBeNull();
});

test('asking for the picker mounts it, and the first pin is a slider', () => {
  view = renderWorkspace(createElement(PerformSurface));
  act(() => openPerformPicker());
  const zoom = [...view.container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Zoom',
  );
  expect(zoom).toBeDefined();
  view.click(zoom ?? null);
  expect(
    view.container.querySelector('input[type="range"][data-field="zoom"]'),
  ).not.toBeNull();
});
