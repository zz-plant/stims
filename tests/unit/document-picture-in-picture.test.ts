import { afterEach, describe, expect, test } from 'bun:test';
import {
  createDocumentPictureInPictureController,
  isDocumentPictureInPictureSupported,
} from '../../src/js/core/services/document-picture-in-picture-service.ts';

/**
 * The point of the document-based popout is the control row. Video
 * picture-in-picture floats the pixels and nothing else — the browser's own
 * transport means nothing over a canvas stream — so the only way to change
 * preset was to go back to the tab the popout existed to get away from.
 *
 * The canvas is mirrored rather than moved, which these also pin: reparenting
 * a WebGL canvas into another document loses its context, and would take the
 * stage away from the window it came from on the way.
 */

const restore: Array<() => void> = [];

function stubGlobal(name: string, value: unknown) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  restore.push(() => {
    if (prior) Object.defineProperty(globalThis, name, prior);
    else Reflect.deleteProperty(globalThis, name);
  });
}

function fakeCanvas() {
  const tracks = [{ stop() {} }];
  return {
    width: 1280,
    height: 720,
    captureStream: () => ({ getTracks: () => tracks }),
  } as unknown as HTMLCanvasElement;
}

/** A stand-in for the popout: a real document, a fake window around it. */
function fakePipWindow() {
  const pipDocument = document.implementation.createHTMLDocument('popout');
  const closed: string[] = [];
  const listeners = new Map<string, () => void>();
  const win = {
    document: pipDocument,
    addEventListener: (type: string, handler: () => void) =>
      listeners.set(type, handler),
    close: () => closed.push('closed'),
  } as unknown as Window;
  return { win, pipDocument, closed, listeners };
}

function install(supported = true) {
  const pip = fakePipWindow();
  const api = supported
    ? { requestWindow: async () => pip.win, window: null }
    : undefined;
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    writable: true,
    value: api,
  });
  restore.push(() => {
    Reflect.deleteProperty(
      window as unknown as Record<string, unknown>,
      'documentPictureInPicture',
    );
  });
  // The support probe also requires canvas capture, which happy-dom's
  // HTMLCanvasElement does not carry.
  const canvasProto = (
    globalThis as unknown as { HTMLCanvasElement?: { prototype: object } }
  ).HTMLCanvasElement?.prototype as Record<string, unknown> | undefined;
  if (canvasProto && !('captureStream' in canvasProto)) {
    canvasProto.captureStream = () => ({ getTracks: () => [] });
    restore.push(() => {
      Reflect.deleteProperty(canvasProto, 'captureStream');
    });
  } else if (!canvasProto) {
    stubGlobal('HTMLCanvasElement', {
      prototype: { captureStream: () => ({ getTracks: () => [] }) },
    });
  }
  return pip;
}

afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

function buildActions() {
  const calls: string[] = [];
  let paused = false;
  return {
    calls,
    setPaused: (next: boolean) => {
      paused = next;
    },
    actions: {
      previousPreset: () => calls.push('previous'),
      nextPreset: () => calls.push('next'),
      togglePlayback: () => {
        paused = !paused;
        calls.push('toggle');
      },
      isPaused: () => paused,
    },
  };
}

describe('document picture-in-picture', () => {
  test('is unsupported without the API', () => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    restore.push(() => {
      Reflect.deleteProperty(
        window as unknown as Record<string, unknown>,
        'documentPictureInPicture',
      );
    });
    expect(isDocumentPictureInPictureSupported()).toBe(false);
  });

  test('refuses rather than throwing when the API is missing', async () => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    restore.push(() => {
      Reflect.deleteProperty(
        window as unknown as Record<string, unknown>,
        'documentPictureInPicture',
      );
    });
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => fakeCanvas(),
      actions: buildActions().actions,
    });
    expect(await controller.enter()).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  test('opens a popout carrying the transport the video one cannot', async () => {
    const pip = install();
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => fakeCanvas(),
      actions: buildActions().actions,
    });

    expect(await controller.enter()).toEqual({ ok: true });
    expect(controller.isActive()).toBe(true);
    const labels = [...pip.pipDocument.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Previous preset', 'Pause', 'Next preset']);
    // Mirrored, never moved.
    expect(pip.pipDocument.getElementById('stage')?.tagName).toBe('VIDEO');
  });

  test('its buttons drive the window they were opened from', async () => {
    const pip = install();
    const { calls, actions } = buildActions();
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => fakeCanvas(),
      actions,
    });
    await controller.enter();

    for (const label of ['Previous preset', 'Next preset', 'Pause']) {
      pip.pipDocument
        .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
        ?.click();
    }
    expect(calls).toEqual(['previous', 'next', 'toggle']);
  });

  test('tracks playback state changed from either window', async () => {
    const pip = install();
    const { actions, setPaused } = buildActions();
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => fakeCanvas(),
      actions,
    });
    await controller.enter();

    const button = () =>
      pip.pipDocument.querySelector('[data-action="playback"]');
    expect(button()?.getAttribute('aria-label')).toBe('Pause');

    // Paused from the main window: nothing re-renders the other document, so
    // the controller has to redraw the button itself.
    setPaused(true);
    controller.syncPlaybackState();
    expect(button()?.getAttribute('aria-label')).toBe('Resume');
    expect(button()?.textContent).toBe('▶');
  });

  test('stops mirroring when the popout is closed', async () => {
    const pip = install();
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => fakeCanvas(),
      actions: buildActions().actions,
    });
    const seen: boolean[] = [];
    controller.subscribe((state) => seen.push(state.active));
    await controller.enter();
    expect(controller.isActive()).toBe(true);

    // `pagehide`, not `unload`: closing a popout does not reliably fire
    // `unload`, and a missed teardown leaves the capture running.
    pip.listeners.get('pagehide')?.();
    expect(controller.isActive()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  test('reports a canvas that is not there yet', async () => {
    install();
    const controller = createDocumentPictureInPictureController({
      getCanvas: () => null,
      actions: buildActions().actions,
    });
    expect(await controller.enter()).toEqual({
      ok: false,
      reason: 'no-canvas',
    });
  });
});
