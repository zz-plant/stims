/**
 * The record panel: what it tells the visitor about a recording, and that a
 * recording it started is the one it saves.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { notifyFrameDrawn } from '../../src/js/core/frame-drawn.ts';
import { CapturePanel } from '../../src/js/frontend/CapturePanel.tsx';
import {
  type WorkspaceContextValue,
  WorkspaceValueProvider,
} from '../../src/js/frontend/workspace-context.tsx';
import {
  makeEngineValue,
  makeUiValue,
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;
const restore: Array<() => void> = [];

beforeEach(() => {
  resetAccessibilityPreferenceState();
  // The panel checks for a stage canvas by constructor, which the test DOM
  // keeps on `window` only.
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals.HTMLCanvasElement === undefined) {
    globals.HTMLCanvasElement = (
      window as unknown as Record<string, unknown>
    ).HTMLCanvasElement;
    restore.push(() => {
      Reflect.deleteProperty(globals, 'HTMLCanvasElement');
    });
  }
});

afterEach(() => {
  view?.dispose();
  view = null;
  while (restore.length) restore.pop()?.();
  resetAccessibilityPreferenceState();
  localStorage.clear();
});

// A recording made with Reduce flashing on carries the governor's dimming
// (stage-presentation.ts). Without a word from the panel, a video that
// darkens wherever the preset strobes reads as a broken export.
test('says the recording is dimmed where it strobes, for as long as Reduce flashing is on', () => {
  setAccessibilityPreference({ reduceFlashing: true });
  view = renderWorkspace(<CapturePanel />);
  expect(view.text()).toMatch(/reduce flashing is on/i);

  act(() => {
    setAccessibilityPreference({ reduceFlashing: false });
  });
  expect(view.text()).not.toMatch(/reduce flashing/i);
});

function define(target: object, name: string, value: unknown) {
  const prior = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value,
  });
  restore.push(() => {
    if (prior) Object.defineProperty(target, name, prior);
    else Reflect.deleteProperty(target, name);
  });
}

/**
 * Enough of a recording browser for the panel to run end to end: canvases
 * with a 2D context and a capture, a MediaRecorder that hands back what it
 * recorded on stop, and object URLs that note what was saved.
 */
function installRecordingBrowser() {
  const canvasProto = (
    window as unknown as Record<string, { prototype: object }>
  ).HTMLCanvasElement.prototype;
  define(canvasProto, 'getContext', () => ({
    globalAlpha: 1,
    fillStyle: '#000000',
    drawImage() {},
    fillRect() {},
  }));
  const track = { kind: 'video', stop() {} };
  define(canvasProto, 'captureStream', () => ({
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  }));
  class FakeMediaRecorder {
    static isTypeSupported = (type: string) => type.startsWith('video/webm');
    mimeType = 'video/webm';
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['frames']) });
      this.onstop?.();
    }
  }
  define(globalThis, 'MediaRecorder', FakeMediaRecorder);
  const saved: Blob[] = [];
  define(URL, 'createObjectURL', (blob: Blob) => {
    saved.push(blob);
    return 'blob:recording';
  });
  define(URL, 'revokeObjectURL', () => {});
  define(
    (window as unknown as Record<string, { prototype: object }>)
      .HTMLAnchorElement.prototype,
    'click',
    () => {},
  );
  return saved;
}

test('a recording survives the engine value changing while it runs', async () => {
  const saved = installRecordingBrowser();
  const stage = document.createElement('div');
  stage.appendChild(document.createElement('canvas'));
  const ui = makeUiValue({
    stageRef: { current: stage } as WorkspaceContextValue['stageRef'],
  });
  // A fresh engine value per render, the way the shell's context changes
  // identity on snapshots, audio and backend state.
  const panel = () => (
    <WorkspaceValueProvider
      ui={ui}
      engine={makeEngineValue()}
      snapshot={{ engineSnapshot: null }}
    >
      <CapturePanel />
    </WorkspaceValueProvider>
  );
  view = renderWorkspace(panel());
  const button = (name: string) =>
    [...(view?.container.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent === name,
    );

  view.click(button('Start recording'));
  notifyFrameDrawn(0);
  // On WebGPU this happened within half a second of Start, and the
  // recording was gone by the time Stop was pressed.
  view.rerender(panel());
  notifyFrameDrawn(16);

  await act(async () => {
    button('Stop and save video')?.click();
  });
  expect(saved).toHaveLength(1);
  expect(view.text()).not.toMatch(/no video frames/i);
});

test('leaving the panel mid-recording still ends the recording', () => {
  installRecordingBrowser();
  const stopped: string[] = [];
  const recorderProto = (
    globalThis as unknown as { MediaRecorder: { prototype: { stop(): void } } }
  ).MediaRecorder.prototype;
  const stop = recorderProto.stop;
  define(recorderProto, 'stop', function (this: { stop(): void }) {
    stopped.push('stop');
    stop.call(this);
  });
  const stage = document.createElement('div');
  stage.appendChild(document.createElement('canvas'));
  view = renderWorkspace(<CapturePanel />, {
    ui: { stageRef: { current: stage } as WorkspaceContextValue['stageRef'] },
  });
  view.click(
    [...view.container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Start recording',
    ),
  );

  view.dispose();
  view = null;
  expect(stopped).toEqual(['stop']);
});
