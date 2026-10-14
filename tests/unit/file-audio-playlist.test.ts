import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createFileAudioStream,
  disposeActiveFileAudio,
  type FilePlaylistSnapshot,
  getActiveFilePlaylist,
  nextFileTrack,
  previousFileTrack,
  selectFileTrack,
  setActiveFileAudio,
  setActiveFileAudioPaused,
  setFileLoopMode,
  subscribeFilePlaylist,
} from '../../src/js/frontend/file-audio.ts';

// Stubs for headless testing environment
class MockAudioContext {
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  createMediaElementSource(_el: HTMLAudioElement) {
    return {
      connect: () => {},
      disconnect: () => {},
    } as unknown as MediaElementAudioSourceNode;
  }
  createMediaStreamDestination() {
    return {
      stream: {} as MediaStream,
      disconnect: () => {},
    } as unknown as MediaStreamAudioDestinationNode;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const originalAudioContext = window.AudioContext;
const originalAudio = window.Audio;
const originalCreateElement = document.createElement.bind(document);

function mockFile(name: string, type = 'audio/mpeg', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  (
    window as unknown as { AudioContext: typeof MockAudioContext }
  ).AudioContext = MockAudioContext;

  document.createElement = ((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === 'audio') {
      const audioEl = el as HTMLAudioElement;
      audioEl.canPlayType = () => 'probably';
      audioEl.load = () => {
        queueMicrotask(() => {
          audioEl.dispatchEvent(new Event('canplay'));
        });
      };
      audioEl.play = () => Promise.resolve();
      audioEl.pause = () => {};
    }
    return el;
  }) as typeof document.createElement;
});

afterEach(() => {
  disposeActiveFileAudio();
  window.AudioContext = originalAudioContext;
  window.Audio = originalAudio;
  document.createElement = originalCreateElement;
});

describe('file audio playlist', () => {
  test('rejects empty file list', async () => {
    await expect(createFileAudioStream([])).rejects.toThrow(
      'No playable audio files were selected.',
    );
  });

  test('creates playlist with single file and defaults to playlist loop', async () => {
    const file = mockFile('track1.mp3');
    const handle = await createFileAudioStream(file);
    setActiveFileAudio(handle);

    const snapshot = getActiveFilePlaylist();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.totalTracks).toBe(1);
    expect(snapshot?.currentIndex).toBe(0);
    expect(snapshot?.currentTrackName).toBe('track1.mp3');
    expect(snapshot?.loopMode).toBe('playlist');
    expect(snapshot?.tracks.length).toBe(1);
  });

  test('creates playlist with multiple tracks', async () => {
    const files = [
      mockFile('intro.mp3'),
      mockFile('verse.mp3'),
      mockFile('chorus.mp3'),
    ];
    const handle = await createFileAudioStream(files);
    setActiveFileAudio(handle);

    const snapshot = getActiveFilePlaylist();
    expect(snapshot?.totalTracks).toBe(3);
    expect(snapshot?.currentIndex).toBe(0);
    expect(snapshot?.currentTrackName).toBe('intro.mp3');
    expect(snapshot?.tracks.map((t) => t.name)).toEqual([
      'intro.mp3',
      'verse.mp3',
      'chorus.mp3',
    ]);
  });

  test('advances tracks sequentially and wraps around', async () => {
    const files = [
      mockFile('one.mp3'),
      mockFile('two.mp3'),
      mockFile('three.mp3'),
    ];
    const handle = await createFileAudioStream(files);
    setActiveFileAudio(handle);

    await nextFileTrack();
    let snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(1);
    expect(snapshot?.currentTrackName).toBe('two.mp3');

    await nextFileTrack();
    snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(2);
    expect(snapshot?.currentTrackName).toBe('three.mp3');

    // Wrap around to start in playlist loop mode
    await nextFileTrack();
    snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(0);
    expect(snapshot?.currentTrackName).toBe('one.mp3');
  });

  test('navigates backwards with previousFileTrack', async () => {
    const files = [
      mockFile('one.mp3'),
      mockFile('two.mp3'),
      mockFile('three.mp3'),
    ];
    const handle = await createFileAudioStream(files);
    setActiveFileAudio(handle);

    // On track 0, previous wraps to last track in playlist loop mode
    await previousFileTrack();
    let snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(2);
    expect(snapshot?.currentTrackName).toBe('three.mp3');

    await previousFileTrack();
    snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(1);
    expect(snapshot?.currentTrackName).toBe('two.mp3');
  });

  test('allows selecting specific track by index', async () => {
    const files = [
      mockFile('one.mp3'),
      mockFile('two.mp3'),
      mockFile('three.mp3'),
    ];
    const handle = await createFileAudioStream(files);
    setActiveFileAudio(handle);

    await selectFileTrack(2);
    let snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(2);
    expect(snapshot?.currentTrackName).toBe('three.mp3');

    await selectFileTrack(0);
    snapshot = getActiveFilePlaylist();
    expect(snapshot?.currentIndex).toBe(0);
    expect(snapshot?.currentTrackName).toBe('one.mp3');
  });

  test('allows appending new tracks with addFiles', async () => {
    const initial = [mockFile('a.mp3'), mockFile('b.mp3')];
    const handle = await createFileAudioStream(initial);
    setActiveFileAudio(handle);

    expect(getActiveFilePlaylist()?.totalTracks).toBe(2);

    handle.addFiles?.([mockFile('c.mp3'), mockFile('d.mp3')]);
    const snapshot = getActiveFilePlaylist();
    expect(snapshot?.totalTracks).toBe(4);
    expect(snapshot?.tracks.map((t) => t.name)).toEqual([
      'a.mp3',
      'b.mp3',
      'c.mp3',
      'd.mp3',
    ]);
  });

  test('respects loopMode none by not wrapping at queue end', async () => {
    const files = [mockFile('first.mp3'), mockFile('last.mp3')];
    const handle = await createFileAudioStream(files, { loopMode: 'none' });
    setActiveFileAudio(handle);

    setFileLoopMode('none');
    await nextFileTrack();
    expect(getActiveFilePlaylist()?.currentIndex).toBe(1);

    // Should stay at last track
    await nextFileTrack();
    expect(getActiveFilePlaylist()?.currentIndex).toBe(1);
  });

  test('a track change while the stage is held stays paused until it resumes', async () => {
    const handle = await createFileAudioStream([
      mockFile('one.mp3'),
      mockFile('two.mp3'),
      mockFile('three.mp3'),
    ]);
    setActiveFileAudio(handle);
    let plays = 0;
    handle.element.play = () => {
      plays += 1;
      return Promise.resolve();
    };

    setActiveFileAudioPaused(true);
    await nextFileTrack();
    await previousFileTrack();
    await selectFileTrack(2);

    // The stage, the dock and the Media Session all still say paused, and
    // the picture is frozen; the new track must not be audible under it.
    expect(getActiveFilePlaylist()?.currentTrackName).toBe('three.mp3');
    expect(plays).toBe(0);

    setActiveFileAudioPaused(false);
    expect(plays).toBe(1);

    await nextFileTrack();
    expect(plays).toBe(2);
  });

  test('a newly adopted file does not inherit the previous hold', async () => {
    const first = await createFileAudioStream([mockFile('a.mp3')]);
    setActiveFileAudio(first);
    setActiveFileAudioPaused(true);

    const second = await createFileAudioStream([
      mockFile('b.mp3'),
      mockFile('c.mp3'),
    ]);
    setActiveFileAudio(second);
    let plays = 0;
    second.element.play = () => {
      plays += 1;
      return Promise.resolve();
    };

    await nextFileTrack();
    expect(plays).toBe(1);
  });

  test('subscribeFilePlaylist notifies on track changes and disposal', async () => {
    const files = [mockFile('track1.mp3'), mockFile('track2.mp3')];
    const handle = await createFileAudioStream(files);

    const received: (FilePlaylistSnapshot | null)[] = [];
    const unsubscribe = subscribeFilePlaylist((state) => {
      received.push(state ? { ...state } : null);
    });

    setActiveFileAudio(handle);
    await nextFileTrack();
    disposeActiveFileAudio();
    unsubscribe();

    expect(received.some((s) => s?.currentTrackName === 'track1.mp3')).toBe(
      true,
    );
    expect(received.some((s) => s?.currentTrackName === 'track2.mp3')).toBe(
      true,
    );
    expect(received[received.length - 1]).toBeNull();
  });
});
