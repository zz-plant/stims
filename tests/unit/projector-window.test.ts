/**
 * The projector mirrors the stage into a window with no chrome. These pin
 * what makes it a mirror rather than a second session: the window shows the
 * stage canvas's own stream, follows the canvas when the renderer replaces
 * it, and survives the operator's page going away without freezing on the
 * last frame or leaving a second window behind.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isHiddenTabSuspendingFrames } from '../../src/js/core/hidden-tab-policy.ts';
import {
  __projectorTestUtils,
  closeProjectorWindow,
  getProjectorState,
  isProjectorWindowOpen,
  openProjectorWindow,
  placeOnScreen,
} from '../../src/js/core/services/projector-window-service.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import {
  handleFlashKeyDown,
  handleFlashKeyUp,
  resetStageUtilitiesForTests,
} from '../../src/js/core/services/stage-utilities.ts';
import { toggleProjectorAction } from '../../src/js/frontend/workspace-actions.ts';

type FakeStream = { canvasId: string; stopped: boolean };

const restore: Array<() => void> = [];

/**
 * The test DOM's canvas has no captureStream, and its constructor is not a
 * global here, so the support probe would say no. Each stream names its
 * canvas so a test can tell which one the projector is showing.
 */
function installCaptureStream() {
  const Canvas = document.createElement('canvas').constructor as {
    prototype: object;
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals.HTMLCanvasElement === undefined) {
    globals.HTMLCanvasElement = Canvas;
    restore.push(() => {
      Reflect.deleteProperty(globals, 'HTMLCanvasElement');
    });
  }
  // The test DOM checks srcObject is a real MediaStream; these are fakes.
  const media = Object.getPrototypeOf(
    Object.getPrototypeOf(document.createElement('video')),
  ) as object;
  const priorSrc = Object.getOwnPropertyDescriptor(media, 'srcObject');
  const sources = new WeakMap<object, unknown>();
  Object.defineProperty(media, 'srcObject', {
    configurable: true,
    get(this: object) {
      return sources.get(this) ?? null;
    },
    set(this: object, value: unknown) {
      sources.set(this, value);
    },
  });
  restore.push(() => {
    if (priorSrc) Object.defineProperty(media, 'srcObject', priorSrc);
    else Reflect.deleteProperty(media, 'srcObject');
  });
  const proto = Canvas.prototype as Record<string, unknown>;
  const prior = Object.getOwnPropertyDescriptor(proto, 'captureStream');
  proto.captureStream = function captureStream(this: HTMLCanvasElement) {
    const stream: FakeStream = { canvasId: this.id, stopped: false };
    return {
      ...stream,
      getTracks: () => [
        {
          stop: () => {
            stream.stopped = true;
          },
        },
      ],
      get stopped() {
        return stream.stopped;
      },
    };
  };
  restore.push(() => {
    if (prior) Object.defineProperty(proto, 'captureStream', prior);
    else Reflect.deleteProperty(proto, 'captureStream');
  });
}

function makeStage(canvasId = 'stage-canvas') {
  const stage = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.id = canvasId;
  canvas.width = 1280;
  canvas.height = 720;
  stage.appendChild(canvas);
  document.body.appendChild(stage);
  restore.push(() => stage.remove());
  return stage;
}

/** A real document inside a fake window, the way the PiP tests build one. */
function fakeProjectorWindow() {
  const doc = document.implementation.createHTMLDocument('');
  const listeners = new Map<string, () => void>();
  const calls: string[] = [];
  const win = {
    document: doc,
    closed: false,
    focus: () => calls.push('focus'),
    close: () => {
      calls.push('close');
      win.closed = true;
    },
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x},${y}`),
    resizeTo: (w: number, h: number) => calls.push(`resizeTo ${w}x${h}`),
    addEventListener: (type: string, handler: () => void) =>
      listeners.set(type, handler),
  };
  return {
    win: win as unknown as Window & { closed: boolean },
    doc,
    listeners,
    calls,
  };
}

function videoIn(doc: Document) {
  return doc.getElementById('stims-projector-stage') as HTMLVideoElement & {
    srcObject: (FakeStream & { stopped: boolean }) | null;
  };
}

/** The test DOM keeps these on `window` only; the browser has them global. */
function installWindowGlobals() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  for (const name of ['MutationObserver', 'KeyboardEvent']) {
    if (globals[name] !== undefined) continue;
    globals[name] = source[name];
    restore.push(() => {
      Reflect.deleteProperty(globals, name);
    });
  }
}

beforeEach(() => {
  installWindowGlobals();
  installCaptureStream();
});
afterEach(() => {
  __projectorTestUtils.reset();
  while (restore.length) restore.pop()?.();
});

describe('projector window', () => {
  test("opens a chrome-free window showing the stage canvas's own stream", () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    let features = '';
    const result = openProjectorWindow({
      getStage: () => stage,
      openWindow: (spec) => {
        features = spec;
        return popup.win;
      },
    });
    expect(result).toEqual({ ok: true, adopted: false });
    // Proportioned from the stage, so it opens without letterboxing.
    expect(features).toBe('popup,width=960,height=540');
    expect(videoIn(popup.doc).srcObject?.canvasId).toBe('stage-canvas');
    expect(popup.doc.title).toBe('Stims projector');
    expect(getProjectorState().open).toBe(true);
    expect(isProjectorWindowOpen()).toBe(true);
  });

  test('follows the canvas when the renderer replaces it', async () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    const first = videoIn(popup.doc).srcObject;

    const replacement = document.createElement('canvas');
    replacement.id = 'rebuilt-canvas';
    stage.replaceChildren(replacement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(videoIn(popup.doc).srcObject?.canvasId).toBe('rebuilt-canvas');
    expect(first?.stopped).toBe(true);
  });

  test('a blocked popup or a missing stage is reported, not claimed', () => {
    const stage = makeStage();
    expect(
      openProjectorWindow({ getStage: () => stage, openWindow: () => null }),
    ).toEqual({ ok: false, reason: 'popup-blocked' });
    let opened = false;
    expect(
      openProjectorWindow({
        getStage: () => document.createElement('div'),
        openWindow: () => {
          opened = true;
          return null;
        },
      }),
    ).toEqual({ ok: false, reason: 'no-canvas' });
    expect(opened).toBe(false);
    expect(getProjectorState().open).toBe(false);
  });

  test('when the operator page goes away the picture goes black and the window stays', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    const stream = videoIn(popup.doc).srcObject;

    window.dispatchEvent(new Event('pagehide'));

    expect(videoIn(popup.doc).srcObject).toBeNull();
    expect(stream?.stopped).toBe(true);
    expect(popup.calls).not.toContain('close');
    expect(getProjectorState().open).toBe(false);
  });

  test('opening again takes back the window it already wrote, hint hidden', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    // The operator reloads: this page's hold on the window is gone, the
    // window itself is still on the projector.
    window.dispatchEvent(new Event('pagehide'));

    const result = openProjectorWindow({
      getStage: () => stage,
      openWindow: () => popup.win,
    });
    expect(result).toEqual({ ok: true, adopted: true });
    expect(videoIn(popup.doc).srcObject?.canvasId).toBe('stage-canvas');
    expect(popup.doc.body.classList.contains('idle')).toBe(true);
  });

  test('closing from the operator side closes the window and stops the capture', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    const stream = videoIn(popup.doc).srcObject;
    closeProjectorWindow();
    expect(popup.calls).toContain('close');
    expect(stream?.stopped).toBe(true);
    expect(getProjectorState().open).toBe(false);
  });

  test('closing the projector itself is noticed', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    popup.listeners.get('pagehide')?.();
    expect(getProjectorState().open).toBe(false);
    expect(isProjectorWindowOpen()).toBe(false);
  });

  test('F in the projector window asks for full screen', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    let requested = 0;
    popup.doc.documentElement.requestFullscreen = async () => {
      requested += 1;
    };
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    // The markup is rewritten on open; the root element is the same one.
    popup.doc.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true }),
    );
    expect(requested).toBe(1);
  });

  test('placing moves the window onto the screen it was given', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    expect(placeOnScreen({ left: 0, top: 0, width: 1, height: 1 }, 'x')).toBe(
      false,
    );
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    expect(
      placeOnScreen(
        { left: 1440, top: 0, width: 1920, height: 1080 },
        'Projector',
      ),
    ).toBe(true);
    expect(popup.calls).toEqual(['moveTo 1440,0', 'resizeTo 1920x1080']);
    expect(getProjectorState().screenLabel).toBe('Projector');
  });
});

describe('what the stage shows over its canvas', () => {
  afterEach(() => resetStageUtilitiesForTests());

  test('the projector carries the stage dimming: governor, ceiling and blackout', async () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    // A capture carries canvas pixels only; the filter is on the element.
    setStageLuminanceChannel(stage, 'governor', 0.5);
    await tick();
    expect(videoIn(popup.doc).style.filter).toBe('brightness(0.500)');

    setStageLuminanceChannel(stage, 'presentation', 0);
    await tick();
    expect(videoIn(popup.doc).style.filter).toBe('brightness(0.000)');

    setStageLuminanceChannel(stage, 'presentation', 1);
    setStageLuminanceChannel(stage, 'governor', 1);
    await tick();
    expect(videoIn(popup.doc).style.filter).toBe('');
    resetStageLuminance(stage);
  });

  test('the white flash reaches the projector and leaves with the key', () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    const flashing = () => popup.doc.getElementById('flash')?.hidden === false;

    handleFlashKeyDown(false);
    expect(flashing()).toBe(true);
    handleFlashKeyUp();
    expect(flashing()).toBe(false);
  });
});

describe('hidden-tab policy', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
  });

  test('an open projector keeps a hidden operator tab from skipping frames', () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    expect(isHiddenTabSuspendingFrames()).toBe(true);
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    openProjectorWindow({ getStage: () => stage, openWindow: () => popup.win });
    expect(isHiddenTabSuspendingFrames()).toBe(false);
  });
});

describe('toggleProjectorAction', () => {
  test('with one screen it opens and says to drag it there', async () => {
    const stage = makeStage();
    const popup = fakeProjectorWindow();
    const originalOpen = window.open;
    window.open = (() => popup.win) as typeof window.open;
    restore.push(() => {
      window.open = originalOpen;
    });
    const messages: string[] = [];
    toggleProjectorAction({
      stage: () => stage,
      announce: (message) => messages.push(message),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages).toEqual([
      'Projector window open. Drag it to the projector. Double-click it or press F there for full screen.',
    ]);

    toggleProjectorAction({
      stage: () => stage,
      announce: (message) => messages.push(message),
    });
    expect(messages.at(-1)).toBe('Projector closed.');
    expect(popup.calls).toContain('close');
  });
});
