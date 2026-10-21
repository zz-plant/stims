/**
 * A copied link carries its sender's audio source. What the launch page does
 * with it is a pure decision, tested here without the React graph: sources
 * that need the recipient's gesture become the launch button; a file, which
 * a link cannot carry, falls back to the demo and says so.
 */
import { describe, expect, test } from 'bun:test';
import {
  resolveRendererFallbackArrival,
  resolveSharedArrival,
  SHARED_FILE_NOTICE,
} from '../../src/js/frontend/shared-arrival.ts';

describe('resolveSharedArrival', () => {
  test.each(['microphone', 'tab', 'youtube'] as const)(
    'offers %s as the launch button instead of starting the demo over it',
    (source) => {
      expect(resolveSharedArrival(source)).toEqual({ kind: 'offer', source });
    },
  );

  test('a file cannot travel in a link: demo starts, and the notice says why', () => {
    expect(resolveSharedArrival('file')).toEqual({
      kind: 'demo',
      notice: SHARED_FILE_NOTICE,
    });
  });

  test('demo, absent and unknown sources start the demo silently as before', () => {
    for (const audio of ['demo', null, 'cassette']) {
      expect(resolveSharedArrival(audio)).toEqual({
        kind: 'demo',
        notice: null,
      });
    }
  });
});

describe('resolveRendererFallbackArrival', () => {
  test.each(['demo', 'microphone', 'tab', 'youtube'] as const)(
    'offers the visitor’s own %s back as Resume and says why the page reloaded',
    (source) => {
      const arrival = resolveRendererFallbackArrival(
        'martin-witchcraft',
        source,
      );
      expect(arrival.presetId).toBe('martin-witchcraft');
      expect(arrival.resumeSource).toBe(source);
      expect(arrival.notice).toBe(
        'This preset needs the WebGL renderer, so Stims reloaded the page. Press Resume to bring your audio back.',
      );
    },
  );

  test('a file cannot be resumed: the notice asks for it again', () => {
    expect(resolveRendererFallbackArrival('martin-witchcraft', 'file')).toEqual(
      {
        presetId: 'martin-witchcraft',
        resumeSource: null,
        notice:
          'This preset needs the WebGL renderer, so Stims reloaded the page. Pick your audio file again to bring your audio back.',
      },
    );
  });

  test('with no audio running there is nothing to bring back', () => {
    expect(resolveRendererFallbackArrival('martin-witchcraft', null)).toEqual({
      presetId: 'martin-witchcraft',
      resumeSource: null,
      notice:
        'This preset needs the WebGL renderer, so Stims reloaded the page.',
    });
  });
});
