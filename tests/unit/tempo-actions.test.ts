import { afterEach, describe, expect, test } from 'bun:test';
import {
  followMidiClock,
  getManualTempo,
  resetManualTempo,
} from '../../src/js/core/manual-tempo.ts';
import type { MidiClockSnapshot } from '../../src/js/core/services/webmidi-controller.ts';
import { followMidiClockTempo } from '../../src/js/frontend/performance-hardware-connect.ts';
import {
  followMusicTempoAction,
  nudgeTempoAction,
  TEMPO_NUDGE_MS,
  tapTempoAction,
} from '../../src/js/frontend/tempo-actions.ts';

afterEach(() => resetManualTempo());

function recorder() {
  const messages: string[] = [];
  return { messages, announce: (message: string) => messages.push(message) };
}

describe('tempo actions', () => {
  test('tapping reports the tempo it set, and a key repeat says nothing', () => {
    const { messages, announce } = recorder();
    tapTempoAction(announce, 1_000);
    tapTempoAction(announce, 1_500);
    tapTempoAction(announce, 1_520);
    expect(messages).toEqual([
      'Tap again on the next beat to set the tempo.',
      '120 BPM from your taps. Auto-advance now switches on your downbeat.',
    ]);
  });

  test('handing the tempo back says whether there was one to hand back', () => {
    const { messages, announce } = recorder();
    followMusicTempoAction(announce);
    tapTempoAction(() => {}, 1_000);
    tapTempoAction(() => {}, 1_500);
    followMusicTempoAction(announce);
    expect(messages).toEqual([
      'Tempo already follows the music.',
      'Tempo follows the music again.',
    ]);
    expect(getManualTempo(1_500)).toBeNull();
  });

  test('a running MIDI clock keeps its tempo against a clear or a nudge', () => {
    const { messages, announce } = recorder();
    followMidiClock({ bpm: 128, running: true, barPosition: 0 });
    followMusicTempoAction(announce);
    nudgeTempoAction(1, announce);
    expect(getManualTempo()?.source).toBe('midi-clock');
    expect(messages).toEqual([
      'MIDI clock sets the tempo while it runs. Stop the clock first.',
      'MIDI clock sets the beat grid while it runs.',
    ]);
  });

  test('a nudge moves a tapped grid and says which way', () => {
    const { messages, announce } = recorder();
    nudgeTempoAction(1, announce);
    tapTempoAction(() => {}, 1_000);
    tapTempoAction(() => {}, 1_500);
    nudgeTempoAction(-1, announce);
    expect(getManualTempo(1_500)?.anchorAt).toBeCloseTo(
      1_000 - TEMPO_NUDGE_MS,
      5,
    );
    expect(messages).toEqual([
      'Tap a tempo first. Nudging moves a tapped beat grid.',
      `Beat grid ${TEMPO_NUDGE_MS} ms earlier.`,
    ]);
  });
});

describe('followMidiClockTempo', () => {
  function stubClock() {
    let listener: ((clock: MidiClockSnapshot) => void) | null = null;
    return {
      midi: {
        onClock: (next: (clock: MidiClockSnapshot) => void) => {
          listener = next;
          return () => {
            listener = null;
          };
        },
      },
      send: (clock: Partial<MidiClockSnapshot>) =>
        listener?.({
          bpm: 124,
          running: true,
          beat: 0,
          barPosition: 0,
          ...clock,
        }),
      attached: () => listener !== null,
    };
  }

  test('says once when a clock takes the tempo and once when it stops', () => {
    const { messages, announce } = recorder();
    const clock = stubClock();
    const stop = followMidiClockTempo({ midi: clock.midi, announce });
    for (let tick = 0; tick < 48; tick += 1)
      clock.send({ barPosition: tick / 96 });
    expect(getManualTempo()?.bpm).toBe(124);
    clock.send({ running: false });
    expect(getManualTempo()).toBeNull();
    expect(messages).toEqual([
      'Following MIDI clock at 124 BPM.',
      'MIDI clock stopped. Tempo follows the music again.',
    ]);
    stop();
    expect(clock.attached()).toBe(false);
  });

  test('a clock that goes silent is reported stopped too', () => {
    const { messages, announce } = recorder();
    const clock = stubClock();
    followMidiClockTempo({ midi: clock.midi, announce });
    clock.send({});
    // No Stop arrives. The next frame's read notices the silence.
    getManualTempo(performance.now() + 5_000);
    expect(messages.at(-1)).toBe(
      'MIDI clock stopped. Tempo follows the music again.',
    );
  });

  test('a tapped tempo is not announced as a clock', () => {
    const { messages, announce } = recorder();
    followMidiClockTempo({ midi: stubClock().midi, announce });
    tapTempoAction(() => {}, 1_000);
    tapTempoAction(() => {}, 1_500);
    expect(messages).toEqual([]);
  });
});
