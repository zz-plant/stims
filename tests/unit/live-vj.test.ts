import { describe, expect, test } from 'bun:test';
import { AutonomousVJController } from '../../src/js/frontend/live-vj.ts';

describe('live VJ controller', () => {
  test('manual input triggers stand-down', () => {
    const t = 1000;
    const ctrl = new AutonomousVJController({
      candidates: ['a', 'b'],
      now: () => t,
    });
    ctrl.noteManualInput();
    expect(ctrl.isInStandDown(1000)).toBe(true);
    expect(ctrl.isInStandDown(1000 + 20000)).toBe(false);
  });

  test('macro tick schedules scene change when not in stand-down', () => {
    const scenes: string[] = [];
    const ctrl = new AutonomousVJController({
      candidates: ['a', 'b'],
      onSceneChange: (c) => scenes.push(c),
    });
    ctrl._macroTick();
    expect(scenes).toEqual(['a']);
    ctrl._macroTick();
    expect(scenes).toEqual(['a', 'b']);
  });

  test('macro tick is suppressed during stand-down', () => {
    const scenes: string[] = [];
    const ctrl = new AutonomousVJController({
      candidates: ['a', 'b'],
      onSceneChange: (c) => scenes.push(c),
      standDownMs: 100000,
    });
    ctrl.noteManualInput();
    ctrl._macroTick();
    expect(scenes).toEqual([]);
  });

  test('strudel beat forwarded', () => {
    const beats: string[] = [];
    const ctrl = new AutonomousVJController({
      candidates: ['a'],
      onBeat: (v) => beats.push(v),
    });
    ctrl.noteBeat('bd');
    expect(beats).toEqual(['bd']);
  });

  test('start/stop toggles running', () => {
    const ctrl = new AutonomousVJController({ candidates: ['a'] });
    expect(ctrl.isRunning()).toBe(false);
    ctrl.start();
    expect(ctrl.isRunning()).toBe(true);
    ctrl.stop();
    expect(ctrl.isRunning()).toBe(false);
  });
});
