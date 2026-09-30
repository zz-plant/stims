/**
 * lab:edit-eval: instructions derived from a human remix, and scoring an
 * answer on what it does rather than how it is written.
 */
import { describe, expect, test } from 'bun:test';
import {
  behaviourDistance,
  buildInstruction,
  checkInstructions,
  type EditTask,
  instructionText,
  measureBehaviour,
  scoreAnswer,
  summarize,
} from '../../scripts/preset-lab-edit-eval.ts';

const parent = `[preset00]
fDecay=0.980000
zoom=1.000000
shapecode_0_enabled=0
per_frame_1=rot = 0.01;
`;

const remix = `[preset00]
fDecay=0.900000
zoom=1.000000
shapecode_0_enabled=1
per_frame_1=rot = 0.01;
per_frame_2=zoom = 1 + 0.1*bass_att;
`;

describe('buildInstruction', () => {
  test('states the remix as intents, equation changes first', () => {
    const items = buildInstruction(parent, remix);
    expect(items[0]).toMatchObject({ kind: 'program', block: 'per_frame' });
    expect(items.map((item) => item.text)).toEqual([
      'rewrite the per-frame equations',
      'enable custom shape 1 enabled',
      'decrease decay',
    ]);
  });

  test('is capped, and the text numbers every step', () => {
    const items = buildInstruction(parent, remix, 2);
    expect(items).toHaveLength(2);
    const text = instructionText('Some Preset', items);
    expect(text).toContain('"Some Preset"');
    expect(text).toContain('1. rewrite the per-frame equations');
    expect(text).toContain('2. enable custom shape 1 enabled');
  });
});

describe('checkInstructions', () => {
  const items = buildInstruction(parent, remix);

  test('the human remix satisfies its own instruction', () => {
    expect(checkInstructions(parent, remix, items)).toEqual([true, true, true]);
  });

  test('the parent satisfies none of it', () => {
    expect(checkInstructions(parent, parent, items)).toEqual([
      false,
      false,
      false,
    ]);
  });

  test('judges effective values, not spelling', () => {
    // Same edits, different spellings and formatting: still satisfied.
    const respelled = `[preset00]
decay=0.85
shapecode_0_enabled=1.0
per_frame_1=rot=0.01;
per_frame_2=zoom = 1.2;
`;
    expect(checkInstructions(parent, respelled, items)).toEqual([
      true,
      true,
      true,
    ]);
    // Moving decay the wrong way fails only that item.
    const wrongWay = respelled.replace('decay=0.85', 'decay=0.99');
    expect(checkInstructions(parent, wrongWay, items)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe('scoring', () => {
  const task: EditTask = {
    taskId: 'parent->remix',
    family: 'test',
    split: 'test',
    parentId: 'parent',
    parentTitle: 'Parent',
    remixTitle: 'Parent (Remix)',
    instruction: '',
    items: buildInstruction(parent, remix),
    parentSource: parent,
  };
  const cache = {
    parent: measureBehaviour(parent, 'parent'),
    remix: measureBehaviour(remix, 'parent'),
  };

  test('a preset is at distance 0 from itself and further from its remix', () => {
    expect(behaviourDistance(cache.parent, cache.parent)).toBe(0);
    expect(behaviourDistance(cache.parent, cache.remix)).toBeGreaterThan(0.01);
  });

  test('the copy baseline is valid, unchanged and follows no instruction', () => {
    const score = scoreAnswer(task, parent, cache);
    expect(score).toMatchObject({
      valid: true,
      changed: false,
      instructionsSatisfied: 0,
      distanceFromParent: 0,
    });
  });

  test('the human remix is the ceiling', () => {
    const score = scoreAnswer(task, remix, cache);
    expect(score).toMatchObject({
      valid: true,
      changed: true,
      instructionsSatisfied: 3,
      distanceFromRemix: 0,
    });
    // Its new bass-driven zoom makes it more audio-reactive than the parent.
    expect(score.reactivityDelta).toBeGreaterThan(0);
  });

  test('an answer that does not compile scores nothing', () => {
    const broken = `[preset00]\nper_frame_1=zoom = (1 + ;\n`;
    const score = scoreAnswer(task, broken, cache);
    expect(score.valid).toBe(false);
    expect(score.instructionsSatisfied).toBe(0);
    expect(score.detail).toContain('compile error');
  });

  test('summaries average the per-task scores', () => {
    const summary = summarize([
      scoreAnswer(task, parent, cache),
      scoreAnswer(task, remix, cache),
    ]);
    expect(summary).toMatchObject({ tasks: 2, valid: 2, changed: 1 });
    expect(summary.instructionScore).toBeCloseTo(0.5, 10);
  });
});
