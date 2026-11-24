/** The breathing setup starts a session; the guide hides nothing it should not and ends on a tap. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { resetAccessibilityPreferenceState } from '../../src/js/core/accessibility-preferences.ts';
import { getGuidedBreathing } from '../../src/js/core/services/guided-breathing.ts';
import { PacedBreathingLayer } from '../../src/js/frontend/PacedBreathingLayer.tsx';
import {
  closeBreathingSetup,
  openBreathingSetup,
  stopPacedBreathing,
} from '../../src/js/frontend/paced-breathing.ts';
import {
  advanceAnimationFrames,
  installAnimationFrameController,
} from '../environment/animation-frame.ts';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;

beforeEach(() => {
  localStorage.clear();
  resetAccessibilityPreferenceState();
  installAnimationFrameController({ autoAdvance: false });
});

afterEach(() => {
  view?.dispose();
  view = null;
  stopPacedBreathing();
  closeBreathingSetup();
});

const button = (text: string) =>
  [...(view?.container.querySelectorAll('button') ?? [])].find(
    (entry) => entry.textContent === text,
  );
const radio = (label: string) =>
  [...(view?.container.querySelectorAll('label.ctl-option') ?? [])]
    .find((entry) => entry.textContent === label)
    ?.querySelector('input');

test('the setup starts a session at the chosen rate, and the guide ends on a tap', () => {
  view = renderWorkspace(<PacedBreathingLayer liveMode />);
  expect(view.text()).toBe('');
  act(() => openBreathingSetup({ rate: 5 }));
  expect(view.text()).toContain('Paced breathing');
  expect(view.text()).toContain('Stop or slow down if you feel light-headed.');
  expect((radio('5') as HTMLInputElement).checked).toBe(true);
  view.click(radio('Longer out'));
  view.click(radio('Open'));
  view.click(button('Start'));
  const session = getGuidedBreathing();
  expect(session?.breathsPerMinute).toBe(5);
  expect(session?.shape).toBe('longer-out');
  expect(session?.endsAt).toBeNull();
  expect(view.text()).toContain('Breathe in');
  expect(view.text()).toContain('5 a minute');
  expect(view.text()).not.toContain('left');
  view.click(view.byLabel('End paced breathing'));
  expect(getGuidedBreathing()).toBeNull();
  expect(view.text()).toBe('');
});

test('Cancel closes the setup without starting anything', () => {
  view = renderWorkspace(<PacedBreathingLayer liveMode />);
  act(() => openBreathingSetup());
  view.click(button('Cancel'));
  expect(getGuidedBreathing()).toBeNull();
  expect(view.text()).toBe('');
});

test('a timed session shows the time left', () => {
  view = renderWorkspace(<PacedBreathingLayer liveMode />);
  act(() => openBreathingSetup());
  view.click(button('Start'));
  expect(getGuidedBreathing()?.endsAt).not.toBeNull();
  act(() => advanceAnimationFrames(1));
  expect(view.text()).toContain('6 a minute · 10:00 left');
});
