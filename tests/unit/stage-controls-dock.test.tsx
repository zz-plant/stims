import { afterEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import { createEmptyEngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import { StageControls } from '../../src/js/frontend/StageControls.tsx';
import { writeShortcutOverrides } from '../../src/js/frontend/shortcut-registry.ts';
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
    const next = rendered.byLabel('Play a random preset');

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

  test('a folded dock still offers an Edit that opens the editor', () => {
    // The bar is visibility:hidden while folded, so its Edit left the
    // accessibility tree exactly when nothing else on the stage named the
    // way in (docs/PRODUCT_MOMENTS.md, "Open one up"). The folded dock
    // carries its own Edit, active only while the bar is away.
    jest.useFakeTimers();
    const panels: Array<string | null> = [];
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        ui: { updatePanel: (panel) => panels.push(panel) },
      },
    );
    try {
      const dockBar = bar(rendered);
      const foldedEdit = () =>
        [
          ...rendered.container.querySelectorAll<HTMLElement>(
            '[data-action="open-editor"]',
          ),
        ].find((edit) => !dockBar?.contains(edit)) ?? null;

      // While the bar is up, the folded Edit is parked out of the tree.
      expect(foldedEdit()).not.toBeNull();
      expect(foldedEdit()?.dataset.visible).toBe('false');
      expect(foldedEdit()?.hasAttribute('inert')).toBe(true);

      elapse(AUTO_HIDE_MS + 50);
      expect(bar(rendered)?.dataset.visible).toBe('false');
      expect(foldedEdit()?.dataset.visible).toBe('true');
      expect(foldedEdit()?.hasAttribute('inert')).toBe(false);
      expect(foldedEdit()?.getAttribute('aria-label')).toBe('Edit this visual');
      expect(foldedEdit()?.getAttribute('title')).toBe('Edit this visual (E)');

      rendered.click(foldedEdit());
      expect(panels).toEqual(['editor']);
    } finally {
      rendered.dispose();
    }
  });
});

describe('stage dock transport', () => {
  test('opens the current visual in the editor without changing its source or audio', () => {
    const updatePanel = jest.fn();
    const updateEditorSource = jest.fn();
    const handleAudioStart = jest.fn();
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        ui: { updatePanel },
        engine: { updateEditorSource, handleAudioStart },
      },
    );
    try {
      const edit = rendered.byLabel('Edit this visual');
      // A control in the bar, labelled with the word it does, not a pill
      // floating over the bar's end.
      expect(pill(rendered)?.contains(edit)).toBe(true);
      expect(edit?.textContent).toBe('Edit');
      rendered.click(edit);
      expect(updatePanel).toHaveBeenCalledWith('editor');
      expect(updateEditorSource).not.toHaveBeenCalled();
      expect(handleAudioStart).not.toHaveBeenCalled();
    } finally {
      rendered.dispose();
    }
  });

  test('the Edit buttons teach the E key the way dock neighbours do', () => {
    // The bar's icon buttons teach their keys in the title ("Previous (P)"),
    // resolved from the registry so a rebind lands there too; the editor
    // entry point follows the same pattern (issue #1338). The key stays out
    // of the accessible name: aria-keyshortcuts announces it.
    const rendered = mount();

    const edit = rendered.byLabel('Edit this visual');
    expect(edit?.getAttribute('title')).toBe('Edit this visual (E)');
    expect(edit?.getAttribute('aria-keyshortcuts')).toBe('E');

    rendered.dispose();
  });

  test('a rebind reaches the open dock without waiting for another render', () => {
    // Nothing else on the dock changes when a key is rebound in the
    // shortcuts dialog, so the hints have to hear about the rebind itself.
    const rendered = mount();
    try {
      const previous = rendered.byLabel('Back to the last preset');
      expect(previous?.getAttribute('data-hint')).toBe(
        'Back to the last preset (P)',
      );

      act(() => {
        writeShortcutOverrides({ previous: ['K'] });
      });
      expect(previous?.getAttribute('data-hint')).toBe(
        'Back to the last preset (K)',
      );
      expect(previous?.getAttribute('aria-keyshortcuts')).toBe('K');
    } finally {
      act(() => {
        writeShortcutOverrides({});
      });
      rendered.dispose();
    }
  });

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

    // Demo audio keeps sounding through a pause, so the button says it
    // pauses the visuals.
    const pause = rendered.byLabel('Pause visuals');
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

    expect(rendered.byLabel('Resume visuals')).not.toBeNull();
    expect(rendered.byLabel('Pause visuals')).toBeNull();
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
  test('the transition lives in the menu, not on the bar', () => {
    const setTransitionMode = jest.fn();
    const setBlendDuration = jest.fn();
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
    try {
      // The bar used to print "2.5s" in a chip a first-time visitor could not
      // read as anything; nothing on it names the transition now.
      expect(pill(rendered)?.textContent).not.toContain('2.5s');
      expect(
        pill(rendered)?.querySelector('[aria-label^="Transition"]'),
      ).toBeNull();

      rendered.click(rendered.byLabel('More actions'));
      const group = rendered.container.querySelector<HTMLElement>(
        '[role="menu"] [role="group"][aria-label^="Transition"]',
      );
      const options = [
        ...(group?.querySelectorAll('[role="menuitemradio"]') ?? []),
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

      // One click reaches any rung.
      rendered.click(options[3]);
      expect(setBlendDuration).toHaveBeenCalledWith(5);
    } finally {
      rendered.dispose();
    }
  });

  test('the overflow menu marks only an exact rung, and names an off-ladder value', () => {
    // The menu's copy of the ladder used to mark the *nearest* rung, so 3s
    // read as 2.5s.
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

describe('stage dock says what each control will do', () => {
  function openMenu(rendered: ReturnType<typeof mount>) {
    rendered.click(rendered.byLabel('More actions'));
    return (action: string) =>
      rendered.container.querySelector<HTMLElement>(
        `[role="menu"] [data-action="${action}"]`,
      );
  }

  test('pause names whether the sound stops with the picture', () => {
    // A file track pauses with the picture; the demo loop keeps playing.
    const file = mount(liveSnapshot({ audioSource: 'file' }));
    expect(file.byLabel('Pause')).not.toBeNull();
    expect(file.byLabel('Pause visuals')).toBeNull();
    file.dispose();

    const demo = mount();
    const pause = demo.byLabel('Pause visuals');
    expect(pause?.dataset.hint).toContain('Sound keeps playing.');
    demo.dispose();
  });

  test('icon buttons carry their name for hover and keyboard focus', () => {
    // A `title` never reaches a keyboard user; data-hint drives the label the
    // dock shows on :hover and :focus-visible.
    const rendered = mount();
    for (const name of [
      'Back to the last preset',
      'Play a similar-looking preset',
      'Play a random preset',
      'More actions',
    ]) {
      const button = rendered.byLabel(name);
      expect(button?.dataset.hint?.startsWith(name)).toBe(true);
      expect(button?.hasAttribute('title')).toBe(false);
    }
    rendered.dispose();
  });

  test('a panel item that would close its open panel says so', () => {
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        ui: {
          routeState: {
            presetId: null,
            collectionTag: null,
            panel: 'browse',
            audioSource: null,
            agentMode: false,
          },
        },
      },
    );
    const item = openMenu(rendered);
    expect(item('open-browse')?.getAttribute('aria-label')).toBe(
      'Close Browse',
    );
    expect(item('open-settings')?.getAttribute('aria-label')).toBe('Settings');
    rendered.dispose();
  });

  test('cast, camera and video publishing say what they start', () => {
    const rendered = mount();
    const item = openMenu(rendered);
    // Casting runs through a watch party; the row says so before the click.
    expect(item('external-display')?.getAttribute('aria-label')).toBe(
      'Cast to a TV or Chromecast (starts a watch party)',
    );
    expect(item('external-display')?.getAttribute('aria-checked')).toBe(
      'false',
    );
    // A toggle that shows its state and names the permission prompt.
    expect(item('toggle-camera')?.getAttribute('role')).toBe(
      'menuitemcheckbox',
    );
    expect(item('toggle-camera')?.getAttribute('aria-label')).toBe(
      'Use camera as video input (asks for camera access)',
    );
    const publish = [
      ...rendered.container.querySelectorAll<HTMLElement>(
        '[role="menu"] [role^="menuitem"]',
      ),
    ].find((element) =>
      element.getAttribute('aria-label')?.startsWith('Publish'),
    );
    expect(publish?.getAttribute('aria-label')).toBe(
      'Publish a public video link…',
    );
    rendered.dispose();
  });

  test('the record item says it will stop and save a running recording', async () => {
    const { setRecordingActive, resetRecordingActiveForTests } = await import(
      '../../src/js/core/services/recording-state.ts'
    );
    const rendered = renderWorkspace(
      createElement(StageControls, {
        isFullscreen: false,
        onToggleFullscreen: () => {},
      }),
      {
        snapshot: liveSnapshot(),
        ui: {
          routeState: {
            presetId: null,
            collectionTag: null,
            panel: 'capture',
            audioSource: null,
            agentMode: false,
          },
        },
      },
    );
    try {
      const item = openMenu(rendered);
      expect(item('open-record')?.getAttribute('aria-label')).toBe(
        'Close the recording panel',
      );
      act(() => setRecordingActive(true));
      expect(item('open-record')?.getAttribute('aria-label')).toBe(
        'Stop recording and save',
      );
    } finally {
      act(() => resetRecordingActiveForTests());
      rendered.dispose();
    }
  });
});
