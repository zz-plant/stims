import { describe, expect, test } from 'bun:test';
import {
  CROSSFADE_TARGET,
  createHardwareCrossfader,
  createPerformanceControlApplier,
  learnRangeFor,
  type QueuedCrossfadeResult,
} from '../../src/js/frontend/performance-hardware-controls.ts';

function manualClock() {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let nextId = 1;
  return {
    now: () => now,
    schedule: (run: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    cancel: (id: unknown) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        }
      }
    },
  };
}

describe('hardware control values', () => {
  test('a field moves live at once and is committed once, after the control rests', () => {
    // Committing every message recompiled the preset on the main thread
    // once per knob message.
    const clock = manualClock();
    const live: Array<[string, number]> = [];
    const committed: Array<[string, number]> = [];
    const controls = createPerformanceControlApplier({
      setFieldLive: (target, value) => live.push([target, value]),
      commitField: (target, value) => committed.push([target, value]),
      crossfade: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    for (const value of [1.0, 1.05, 1.1, 1.15]) {
      controls.apply('zoom', value);
      clock.advance(20);
    }
    expect(live.length).toBe(4);
    expect(committed).toEqual([]);
    clock.advance(300);
    expect(committed).toEqual([['zoom', 1.15]]);
  });

  test('the crossfader never reaches the preset', () => {
    // The factory profiles bind a fader to it; down the field path it wrote
    // a crossfade= line into the running preset's code.
    const fields: string[] = [];
    const fades: number[] = [];
    const controls = createPerformanceControlApplier({
      setFieldLive: (target) => fields.push(target),
      commitField: (target) => fields.push(target),
      crossfade: (position) => fades.push(position),
    });
    controls.apply(CROSSFADE_TARGET, 0.4);
    controls.dispose();
    expect(fields).toEqual([]);
    expect(fades).toEqual([0.4]);
  });
});

describe('hardware crossfader', () => {
  function rig(queueResult: QueuedCrossfadeResult = 'started') {
    const clock = manualClock();
    let position: number | null = null;
    const set: number[] = [];
    const notices: string[] = [];
    let starts = 0;
    const fader = createHardwareCrossfader({
      getPosition: () => position,
      setPosition: (next) => {
        set.push(next);
        position = next;
      },
      startQueued: () => {
        starts += 1;
        return queueResult;
      },
      announce: (message) => notices.push(message),
      now: clock.now,
    });
    return {
      fader,
      clock,
      set,
      notices,
      starts: () => starts,
      goLive: (at: number) => {
        position = at;
      },
      finish: () => {
        position = null;
      },
    };
  }

  test('pushed off its resting end it takes the next queued preset, once', () => {
    const r = rig();
    r.fader.move(0.02);
    expect(r.starts()).toBe(0);
    r.fader.move(0.1);
    r.fader.move(0.2); // still loading the incoming preset
    expect(r.starts()).toBe(1);
    r.goLive(0);
    r.fader.move(0.3);
    expect(r.set).toEqual([0.3]);
  });

  test('after a finished fade the other end is home, so pulling back starts the next', () => {
    const r = rig();
    r.fader.move(0.5);
    r.goLive(0);
    r.fader.move(1);
    r.finish();
    r.clock.advance(5000);
    r.fader.move(0.98); // just off the new resting end
    expect(r.starts()).toBe(1);
    r.fader.move(0.8);
    expect(r.starts()).toBe(2);
    r.goLive(0);
    r.fader.move(0.6);
    expect(r.set.at(-1)).toBeCloseTo(0.4);
  });

  test('with nothing queued it says so, once a while, and starts nothing', () => {
    const r = rig('empty');
    r.fader.move(0.3);
    r.fader.move(0.4);
    expect(r.notices).toEqual(['Queue a preset to crossfade into it.']);
    r.clock.advance(5000);
    r.fader.move(0.5);
    expect(r.notices.length).toBe(2);
    expect(r.set).toEqual([]);
  });
});

describe('learn ranges', () => {
  test('come from the Perform faders, then the factory profiles', () => {
    expect(learnRangeFor('zoom')).toEqual({ min: 0.8, max: 1.2 });
    expect(learnRangeFor('wave_a')).toEqual({ min: 0, max: 1 });
    expect(learnRangeFor('q31')).toBeNull();
  });
});
