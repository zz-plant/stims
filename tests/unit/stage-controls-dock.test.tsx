import { afterEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { StageControls } from '../../src/js/frontend/StageControls.tsx';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

/**
 * The dock's hide/reveal rules, against rendered DOM. Each of these was a
 * measured defect in the browser first: the bar faded out from under a
 * resting pointer; the reveal handle painted over the title while focus held
 * the bar up; and the transport slot ran "Stop audio" behind a mute glyph.
 */

afterEach(() => {
  jest.useRealTimers();
});

const AUTO_HIDE_MS = 3000;

function liveSnapshot(overrides = {}) {
  return {
    ...createEmptyEngineSnapshot(),
    runtimeReady: true,
    audioActive: true,
    audioSource: 'demo' as const,
    transitionMode: 'blend' as const,
    blendDuration: 2,
    ...overrides,
  };
}

function mount(snapshot = liveSnapshot()) {
  return renderWorkspace(
    createElement(StageControls, {
      isFullscreen: false,
      onToggleFullscreen: () => {},
    }),
    { snapshot },
  );
}

// CSS-module class names are empty under the test bundler, so the bar is
// found by the state attribute it publishes and the pill by position.
function bar(rendered: ReturnType<typeof mount>) {
  return rendered.container.querySelector<HTMLElement>('[data-visible]');
}

function pill(rendered: ReturnType<typeof mount>) {
  return bar(rendered)?.firstElementChild as HTMLElement | null;
}

// React derives onPointerEnter/Leave from the over/out pair, so those are
// what a test has to dispatch; a raw `pointerenter` never reaches React.
function pointer(target: Element | null, type: 'enter' | 'leave') {
  const event = new Event(type === 'enter' ? 'pointerover' : 'pointerout', {
    bubbles: true,
  });
  // The test DOM has no MouseEvent; React only reads relatedTarget off it.
  Object.defineProperty(event, 'relatedTarget', {
    value: type === 'enter' ? null : document.body,
  });
  act(() => {
    target?.dispatchEvent(event);
  });
}

function elapse(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('stage dock auto-hide', () => {
  test('hides after three still seconds with nothing touching it', () => {
    jest.useFakeTimers();
    const rendered = mount();

    expect(bar(rendered)?.dataset.visible).toBe('true');
    elapse(AUTO_HIDE_MS + 50);
    expect(bar(rendered)?.dataset.visible).toBe('false');

    rendered.dispose();
  });

  test('a pointer resting on the pill holds it up past the timer', () => {
    jest.useFakeTimers();
    const rendered = mount();

    pointer(pill(rendered), 'enter');
    elapse(AUTO_HIDE_MS * 3);
    expect(bar(rendered)?.dataset.visible).toBe('true');

    // Leaving starts the countdown again from now, not from the stale one.
    pointer(pill(rendered), 'leave');
    elapse(AUTO_HIDE_MS - 100);
    expect(bar(rendered)?.dataset.visible).toBe('true');
    elapse(200);
    expect(bar(rendered)?.dataset.visible).toBe('false');

    rendered.dispose();
  });

  test('focus inside the pill holds it up, and the handle stays out of the way', () => {
    jest.useFakeTimers();
    const rendered = mount();
    const next = rendered.byLabel('Shuffle to random preset');

    act(() => next?.focus());
    elapse(AUTO_HIDE_MS * 2);

    expect(bar(rendered)?.dataset.visible).toBe('true');
    // Before this the bar was painted by :focus-within while the JS flag said
    // hidden, so the "Controls" handle rendered on top of the preset title.
    const handle = rendered.byLabel('Show controls');
    expect(handle?.dataset.visible).toBe('false');
    expect(handle?.hasAttribute('inert')).toBe(true);

    rendered.dispose();
  });
});

describe('stage dock transport', () => {
  test('the transport slot pauses and resumes instead of stopping', () => {
    const calls: string[] = [];
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        engine: {
          handleTogglePlayback: () => calls.push('toggle'),
          handleAudioStop: () => calls.push('stop'),
        },
      },
    );

    const pause = rendered.byLabel('Pause');
    expect(pause).not.toBeNull();
    // Stopping is no longer one click on the bar.
    expect(
      rendered.container.querySelector('[data-action="stop-audio"]'),
    ).toBeNull();

    rendered.click(pause);
    expect(calls).toEqual(['toggle']);

    rendered.dispose();
  });

  test('a paused stage says so in the title and offers Resume', () => {
    const rendered = mount(liveSnapshot({ playbackPaused: true }));

    expect(rendered.byLabel('Resume')).not.toBeNull();
    expect(rendered.byLabel('Pause')).toBeNull();
    expect(pill(rendered)?.textContent).toContain('Paused');

    rendered.dispose();
  });

  test('a paused stage does not claim the visuals are reacting', () => {
    const rendered = mount(liveSnapshot({ playbackPaused: true }));

    const status = rendered.container.querySelector<HTMLElement>(
      '[data-action="audio-status"]',
    );
    expect(status?.getAttribute('aria-label')).toBe(
      'Audio status. Paused. The picture is held where it was. Press Space or Resume to carry on.',
    );

    rendered.dispose();
  });

  test('a paused stage keeps the bar up past the idle timer', () => {
    // Otherwise a pause was a frozen frame under a "Controls" handle three
    // seconds later — indistinguishable from a hung renderer.
    jest.useFakeTimers();
    const rendered = mount(liveSnapshot({ playbackPaused: true }));

    elapse(AUTO_HIDE_MS * 2);
    expect(bar(rendered)?.dataset.visible).toBe('true');
    expect(rendered.byLabel('Show controls')?.dataset.visible).toBe('false');

    rendered.dispose();
  });

  test('stopping audio is in the menu under a label that says where it goes', () => {
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        engine: { selectedPreset: makePresetEntry() },
      },
    );

    rendered.click(rendered.byLabel('More actions'));
    const stop = rendered.container.querySelector<HTMLElement>(
      '[data-action="stop-audio"]',
    );
    expect(stop?.getAttribute('aria-label')).toBe(
      'Stop audio and go back to start',
    );
    expect(
      rendered.container.querySelector('[data-action="toggle-playback"]'),
    ).not.toBeNull();
    // Save has a home in the menu now that phones drop it from the bar.
    expect(
      rendered.container.querySelector(
        '[role="menu"] [data-action="save-preset"]',
      ),
    ).not.toBeNull();

    rendered.dispose();
  });
});

describe('stage dock transition control', () => {
  test('prints the engine value, not the nearest rung', () => {
    const rendered = mount(liveSnapshot({ blendDuration: 2.5 }));

    const trigger = rendered.container.querySelector<HTMLElement>(
      '[data-action="transition-menu"]',
    );
    expect(trigger?.textContent).toBe('2.5s');
    expect(trigger?.getAttribute('aria-label')).toBe(
      'Transition: Blend 2.5s. Choose a duration.',
    );

    rendered.dispose();
  });

  test('opens the ladder as a popover with the current rung checked', () => {
    const setTransitionMode = jest.fn();
    const setBlendDuration = jest.fn();
    // The product default. It used to be off the ladder, so a fresh visitor
    // opened this popover to four rungs with none of them marked.
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot({ blendDuration: 2.5 }),
        engine: { setTransitionMode, setBlendDuration },
      },
    );

    const trigger = rendered.container.querySelector<HTMLElement>(
      '[data-action="transition-menu"]',
    );
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    rendered.click(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    const popover = rendered.container.querySelector<HTMLElement>(
      '[data-menu="transition"]',
    );
    const options = [
      ...(popover?.querySelectorAll('[role="menuitemradio"]') ?? []),
    ];
    expect(options.map((option) => option.textContent)).toEqual([
      'Cut',
      '1s',
      '2.5s',
      '5s',
    ]);
    expect(
      options.map((option) => option.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'true', 'false']);

    // One click reaches any rung, and the popover closes on it.
    rendered.click(options[3]);
    expect(setBlendDuration).toHaveBeenCalledWith(5);
    expect(
      rendered.container.querySelector('[data-menu="transition"]'),
    ).toBeNull();

    rendered.dispose();
  });

  test('the overflow menu marks the same rung as the popover, and names an off-ladder value', () => {
    // The menu's copy of the ladder marked the *nearest* rung while the
    // popover marked an exact one: three answers for one state.
    const checkedIn = (blendDuration: number) => {
      const rendered = mount(liveSnapshot({ blendDuration }));
      rendered.click(rendered.byLabel('More actions'));
      const group = rendered.container.querySelector<HTMLElement>(
        '[role="menu"] [role="group"][aria-label^="Transition"]',
      );
      const checked = [
        ...(group?.querySelectorAll('[role="menuitemradio"]') ?? []),
      ]
        .filter((option) => option.getAttribute('aria-checked') === 'true')
        .map((option) => option.textContent);
      const label = group?.getAttribute('aria-label');
      rendered.dispose();
      return { checked, label };
    };

    expect(checkedIn(2.5)).toEqual({ checked: ['2.5s'], label: 'Transition' });
    expect(checkedIn(3)).toEqual({
      checked: [],
      label: 'Transition, currently Blend 3s',
    });
  });
});
