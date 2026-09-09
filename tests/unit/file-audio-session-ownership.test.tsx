import { afterEach, describe, expect, test } from 'bun:test';
import { AudioSourcePanel } from '../../src/js/frontend/AudioSourcePanel.tsx';
import {
  disposeActiveFileAudio,
  type FileAudioHandle,
  getActiveFileAudioName,
  setActiveFileAudio,
} from '../../src/js/frontend/file-audio.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

/**
 * File playback belongs to the audio session, not to whichever copy of the
 * audio panel happens to be mounted.
 *
 * The panel renders twice at once — the home hero keeps one for the whole
 * session, the Settings sheet mounts another each time it opens — and the
 * handle used to live in a ref there, disposed on unmount. Closing Settings
 * therefore stopped the music while the engine, the route and the dock all
 * still reported a file playing; and from the home copy, which never
 * unmounts, "Stop audio" left the element looping audibly forever.
 */

function makeHandle(name: string) {
  let disposed = 0;
  const handle: FileAudioHandle = {
    // The engine only ever reads `.stream`, and nothing in these tests gets
    // that far, so a bare object stands in for a MediaStream that happy-dom
    // cannot construct.
    stream: {} as MediaStream,
    element: {} as HTMLAudioElement,
    name,
    dispose: () => {
      disposed += 1;
    },
  };
  return {
    handle,
    get disposed() {
      return disposed;
    },
  };
}

afterEach(() => {
  disposeActiveFileAudio();
});

describe('file audio session ownership', () => {
  test('adopting a second file disposes the first', () => {
    const first = makeHandle('first.mp3');
    const second = makeHandle('second.mp3');

    setActiveFileAudio(first.handle);
    expect(first.disposed).toBe(0);
    expect(getActiveFileAudioName()).toBe('first.mp3');

    setActiveFileAudio(second.handle);

    // Two live graphs would both be audible and both feed the analyser.
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(0);
    expect(getActiveFileAudioName()).toBe('second.mp3');
  });

  test('disposing clears the session and is safe to repeat', () => {
    const only = makeHandle('only.mp3');
    setActiveFileAudio(only.handle);

    disposeActiveFileAudio();
    expect(only.disposed).toBe(1);
    expect(getActiveFileAudioName()).toBeNull();

    disposeActiveFileAudio();
    expect(only.disposed).toBe(1);
  });

  test('re-adopting the same handle does not dispose it', () => {
    const same = makeHandle('same.mp3');
    setActiveFileAudio(same.handle);
    setActiveFileAudio(same.handle);

    expect(same.disposed).toBe(0);
    expect(getActiveFileAudioName()).toBe('same.mp3');
  });

  test('unmounting the audio panel leaves playback alone', () => {
    const playing = makeHandle('set.mp3');
    setActiveFileAudio(playing.handle);

    const rendered = renderWorkspace(<AudioSourcePanel showHelp={false} />);
    rendered.dispose();

    // Closing the Settings sheet unmounts a copy of this panel. It must not
    // take the music with it.
    expect(playing.disposed).toBe(0);
    expect(getActiveFileAudioName()).toBe('set.mp3');
  });

  test('a freshly mounted panel reports the file already playing', () => {
    setActiveFileAudio(makeHandle('already-playing.mp3').handle);

    const rendered = renderWorkspace(<AudioSourcePanel showHelp={false} />);
    try {
      // Not "Pick a track" — that offered to start something already started.
      expect(rendered.text()).toContain('Playing already-playing.mp3');
    } finally {
      rendered.dispose();
    }
  });

  test('with nothing playing the panel offers to pick a track', () => {
    const rendered = renderWorkspace(<AudioSourcePanel showHelp={false} />);
    try {
      expect(rendered.text()).toContain('Pick a track');
    } finally {
      rendered.dispose();
    }
  });
});
