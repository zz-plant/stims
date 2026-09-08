import { expect, test } from 'bun:test';
import {
  classifyAudioSignal,
  describeAudioSignal,
  nextSignalMark,
  SILENCE_GRACE_MS,
} from '../../src/js/frontend/audio-signal-state.ts';

test('no source reads as off, whatever the meter last said', () => {
  expect(
    classifyAudioSignal({
      hasSource: false,
      awaitingGesture: false,
      msSinceSignal: 0,
    }),
  ).toBe('off');
});

test('the autoplay gate outranks silence, because it has a different fix', () => {
  // Both states look identical at the analyser — zero energy — but only one
  // is fixed by tapping the page, so the gate has to win.
  expect(
    classifyAudioSignal({
      hasSource: true,
      awaitingGesture: true,
      msSinceSignal: null,
    }),
  ).toBe('awaiting-gesture');
});

test('a source that has never produced signal is silent immediately', () => {
  expect(
    classifyAudioSignal({
      hasSource: true,
      awaitingGesture: false,
      msSinceSignal: null,
    }),
  ).toBe('silent');
});

test('a quiet passage inside the grace window still reads as live', () => {
  expect(
    classifyAudioSignal({
      hasSource: true,
      awaitingGesture: false,
      msSinceSignal: SILENCE_GRACE_MS - 1,
    }),
  ).toBe('live');
});

test('silence past the grace window is reported', () => {
  expect(
    classifyAudioSignal({
      hasSource: true,
      awaitingGesture: false,
      msSinceSignal: SILENCE_GRACE_MS,
    }),
  ).toBe('silent');
});

test('every state names the source it is describing', () => {
  // The detail line is the control's accessible name, so a state that
  // dropped the source name would leave a screen-reader user with "connected
  // but nothing is coming through" and no way to tell which source.
  for (const state of ['awaiting-gesture', 'silent', 'live'] as const) {
    expect(describeAudioSignal(state, 'Microphone').detail).toContain(
      'Microphone',
    );
  }
});

test('the off state does not invent a source it has no name for', () => {
  const { detail } = describeAudioSignal('off', null);
  expect(detail).not.toContain('undefined');
  expect(detail).not.toContain('null');
});

test('a steady non-zero level keeps refreshing the mark', () => {
  // The regression this exists for: the energy store notifies on change only,
  // so a level pinned at half scale delivers no events. A mark that advanced
  // only on notification went stale and the control said "No signal" over a
  // meter sitting at 0.587 — confidently wrong in exactly the situation it
  // was added to explain.
  let mark = nextSignalMark(0.587, null, 1_000);
  expect(mark).toBe(1_000);

  mark = nextSignalMark(0.587, mark, 1_000 + SILENCE_GRACE_MS * 2);
  expect(mark).toBe(1_000 + SILENCE_GRACE_MS * 2);

  expect(
    classifyAudioSignal({
      hasSource: true,
      awaitingGesture: false,
      msSinceSignal: 0,
    }),
  ).toBe('live');
});

test('a level under the floor leaves the previous mark to age out', () => {
  expect(nextSignalMark(0, 500, 9_000)).toBe(500);
  expect(nextSignalMark(0, null, 9_000)).toBeNull();
});
