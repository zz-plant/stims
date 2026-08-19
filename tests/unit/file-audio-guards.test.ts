import { afterEach, describe, expect, test } from 'bun:test';
import { canProbablyPlay } from '../../src/js/frontend/file-audio.ts';

/**
 * `canProbablyPlay` is the gate that decides whether we even try to decode a
 * picked file. Its failure modes all have to land on "try anyway": the OS
 * often hands over a File with no MIME type at all, and refusing those would
 * reject perfectly playable tracks before the decoder ever sees them. Only a
 * definitive "cannot play" from the browser should stop us.
 */

const originalCreateElement = document.createElement.bind(document);

function stubCanPlayType(impl: (type: string) => string) {
  document.createElement = ((tag: string) => {
    if (tag === 'audio') {
      return { canPlayType: impl } as unknown as HTMLAudioElement;
    }
    return originalCreateElement(tag);
  }) as typeof document.createElement;
}

afterEach(() => {
  document.createElement = originalCreateElement;
});

function fileWithType(type: string) {
  return new File([new Uint8Array([0])], 'track', { type });
}

describe('canProbablyPlay', () => {
  test('a file with no MIME type is attempted, not rejected', () => {
    stubCanPlayType(() => '');
    expect(canProbablyPlay(fileWithType(''))).toBe(true);
  });

  test('a definitively unsupported type is rejected', () => {
    stubCanPlayType(() => '');
    expect(canProbablyPlay(fileWithType('audio/x-nonsense'))).toBe(false);
  });

  test('"maybe" counts as playable — it is the browser hedging, not refusing', () => {
    stubCanPlayType(() => 'maybe');
    expect(canProbablyPlay(fileWithType('audio/mpeg'))).toBe(true);
  });

  test('"probably" counts as playable', () => {
    stubCanPlayType(() => 'probably');
    expect(canProbablyPlay(fileWithType('audio/wav'))).toBe(true);
  });

  test('a throwing canPlayType degrades to attempting playback', () => {
    stubCanPlayType(() => {
      throw new Error('no audio element in this environment');
    });
    expect(canProbablyPlay(fileWithType('audio/flac'))).toBe(true);
  });
});
