/**
 * A copied link carries its sender's audio source. What the launch page does
 * with it is a pure decision, tested here without the React graph: sources
 * that need the recipient's gesture become the launch button; a file, which
 * a link cannot carry, falls back to the demo and says so.
 */
import { describe, expect, test } from 'bun:test';
import {
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
