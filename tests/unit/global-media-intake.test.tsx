/**
 * Files dropped and YouTube links pasted anywhere reach the right place, and
 * leave text fields, the code editor and other drop zones alone.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { GlobalMediaIntake } from '../../src/js/frontend/GlobalMediaIntake.tsx';
import { resetDeviceDetectCache } from '../../src/js/utils/browser/device-detect.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0';
const savedMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaDevices',
);
const savedUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');

function browseAs(userAgent: string) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
  resetDeviceDetectCache();
}

function mount({ engineReady = true, audioActive = false } = {}) {
  const imported: unknown[] = [];
  const urls: string[] = [];
  const loaded: Array<string | undefined> = [];
  const panels: unknown[] = [];
  const messages: Array<string | null> = [];
  const sources: unknown[] = [];
  const rendered = renderWorkspace(createElement(GlobalMediaIntake), {
    engine: {
      engineReady,
      audioActive,
      loadYouTubePreview: ((url?: string) => {
        loaded.push(url);
      }) as never,
      startAudioSource: (async (request: unknown) => {
        sources.push(request);
      }) as never,
    },
    ui: {
      handleImport: (async (files: unknown) => {
        imported.push(files);
      }) as never,
      setYoutubeUrl: (url: string) => {
        urls.push(url);
      },
      updatePanel: (panel) => {
        panels.push(panel);
      },
      setStatusMessage: (message: string | null) => {
        messages.push(message);
      },
    },
  });
  return { rendered, imported, urls, loaded, panels, messages, sources };
}

function fileDrag(type: string, files: File[]) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files },
  });
  return event;
}

function dropOn(target: Element, files: File[]) {
  const event = fileDrag('drop', files);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function pasteOn(target: Element, text: string) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const preset = () => new File(['[preset00]'], 'mine.milk');

beforeEach(() => {
  browseAs(CHROME);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: () => {} },
  });
});

afterEach(() => {
  if (savedUserAgent) {
    Object.defineProperty(navigator, 'userAgent', savedUserAgent);
  } else {
    Reflect.deleteProperty(navigator, 'userAgent');
  }
  resetDeviceDetectCache();
  if (savedMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

describe('dropping a file anywhere', () => {
  test('a preset file goes to import', () => {
    const view = mount();
    const file = preset();
    const event = dropOn(document.body, [file]);
    expect(event.defaultPrevented).toBe(true);
    expect(view.imported).toEqual([[file]]);
    view.rendered.dispose();
  });

  test('a file nothing can play says so', async () => {
    const view = mount();
    dropOn(document.body, [
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    ]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The test DOM's audio element reports nothing playable for any type.
    expect(view.messages.at(-1)).toContain("can't play");
    expect(view.sources).toEqual([]);
    view.rendered.dispose();
  });

  test('before the engine is ready it says so instead of starting', () => {
    const view = mount({ engineReady: false });
    dropOn(document.body, [
      new File(['x'], 'song.mp3', { type: 'audio/mpeg' }),
    ]);
    expect(view.messages).toEqual(['The visualizer is still loading.']);
    view.rendered.dispose();
  });

  test('a drop zone that already took the file keeps it', () => {
    const view = mount();
    const zone = document.createElement('div');
    zone.addEventListener('drop', (event) => event.preventDefault());
    document.body.append(zone);
    dropOn(zone, [preset()]);
    expect(view.imported).toEqual([]);
    zone.remove();
    view.rendered.dispose();
  });

  test('a drop on a text field stays with the field', () => {
    const view = mount();
    const field = document.createElement('input');
    document.body.append(field);
    const event = dropOn(field, [preset()]);
    expect(event.defaultPrevented).toBe(false);
    expect(view.imported).toEqual([]);
    field.remove();
    view.rendered.dispose();
  });

  test('dragging files shows the target until the drag leaves', () => {
    const view = mount();
    const shown = () =>
      view.rendered.container.querySelector('.stims-shell__global-drop');
    const dispatch = (type: string) =>
      act(() => {
        document.body.dispatchEvent(fileDrag(type, []));
      });
    dispatch('dragenter');
    expect(shown()).not.toBeNull();
    dispatch('dragenter');
    dispatch('dragleave');
    expect(shown()).not.toBeNull();
    dispatch('dragleave');
    expect(shown()).toBeNull();
    view.rendered.dispose();
  });
});

describe('pasting a YouTube link anywhere', () => {
  test('on the landing it fills the field and loads the video', () => {
    const view = mount();
    const event = pasteOn(document.body, LINK);
    expect(event.defaultPrevented).toBe(true);
    expect(view.urls).toEqual([LINK]);
    expect(view.loaded).toEqual([LINK]);
    expect(view.panels).toEqual([]);
    view.rendered.dispose();
  });

  test('on a running stage it also opens the panel with the field', () => {
    const view = mount({ audioActive: true });
    pasteOn(document.body, LINK);
    expect(view.panels).toEqual(['settings']);
    view.rendered.dispose();
  });

  test('other text is left alone', () => {
    const view = mount();
    const event = pasteOn(document.body, 'not a link');
    expect(event.defaultPrevented).toBe(false);
    expect(view.urls).toEqual([]);
    view.rendered.dispose();
  });

  test('a paste into a text field or the code editor stays there', () => {
    const view = mount();
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const line = document.createElement('span');
    editor.append(line);
    const field = document.createElement('textarea');
    document.body.append(editor, field);
    pasteOn(line, LINK);
    pasteOn(field, LINK);
    expect(view.urls).toEqual([]);
    editor.remove();
    field.remove();
    view.rendered.dispose();
  });

  test('a browser whose capture drops audio is not offered it', () => {
    browseAs(FIREFOX);
    const view = mount();
    pasteOn(document.body, LINK);
    expect(view.urls).toEqual([]);
    view.rendered.dispose();
  });

  test('where capture is unavailable nothing is offered', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {},
    });
    const view = mount();
    pasteOn(document.body, LINK);
    expect(view.urls).toEqual([]);
    view.rendered.dispose();
  });
});
