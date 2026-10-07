/**
 * The harness is what an implementer trusts to judge their engine, so it
 * must be wrong in neither direction: a runner that produces the expected
 * state passes, one that does not fails with a message naming the variable
 * or slot, one that throws is recorded rather than aborting the run, and
 * provisional cases never count against conformance.
 */
import { describe, expect, test } from 'bun:test';
import {
  checkCase,
  conforms,
  EEL_CONFORMANCE_BUFFER_SLOTS,
  EEL_CONFORMANCE_RANDOM_DRAW,
  type EelConformanceCase,
  type EelRunner,
  formatReport,
  loadEelConformanceCases,
  runConformance,
  seedBuffer,
} from '../src/index.ts';

const CASES = loadEelConformanceCases();

/** A runner that writes exactly what each case expects: the oracle. */
const oracle: EelRunner = ({ env, megabuf, gmegabuf, program }) => {
  const specCase = CASES.find((c) => c.program === program);
  if (!specCase) throw new Error('unknown program');
  Object.assign(env, specCase.expected);
  for (const [slot, value] of Object.entries(specCase.expectedMegabuf ?? {})) {
    megabuf[Number(slot)] = value;
  }
  for (const [slot, value] of Object.entries(specCase.expectedGmegabuf ?? {})) {
    gmegabuf[Number(slot)] = value;
  }
};

const shared = {
  megabuf: new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS),
  gmegabuf: new Float32Array(EEL_CONFORMANCE_BUFFER_SLOTS),
};

describe('runConformance', () => {
  test('an oracle runner passes every case', async () => {
    const report = await runConformance(oracle, { buffers: shared });
    expect(report.total).toBe(CASES.length);
    expect(report.passed).toBe(CASES.length);
    expect(report.failed).toBe(0);
    expect(report.errored).toBe(0);
    expect(conforms(report)).toBe(true);
  });

  test('a runner that does nothing fails every case with a non-zero expectation', async () => {
    const report = await runConformance(() => {}, { buffers: shared });
    const nonTrivial = CASES.filter((c) =>
      [
        ...Object.values(c.expected),
        ...Object.values(c.expectedMegabuf ?? {}),
        ...Object.values(c.expectedGmegabuf ?? {}),
      ].some((v) => v !== 0),
    );
    expect(report.failed).toBe(nonTrivial.length);
    expect(conforms(report)).toBe(false);
    const failing = report.results.find((r) => r.status === 'fail');
    expect(failing?.failures[0]).toMatch(/expected .*, got 0$/);
  });

  test('a throwing runner is recorded as an error, and the run continues', async () => {
    let calls = 0;
    const report = await runConformance(
      () => {
        calls += 1;
        throw new Error('not implemented');
      },
      { buffers: shared },
    );
    expect(calls).toBe(CASES.length);
    expect(report.errored).toBe(CASES.length);
    expect(report.results[0]?.failures).toEqual(['threw: not implemented']);
  });

  test('seeds env and both buffers before each case, lower-casing names', async () => {
    const seen: Array<{
      env: Record<string, number>;
      megabuf: number[];
      gmegabuf: number[];
      draw: number;
    }> = [];
    const custom: EelConformanceCase = {
      section: 'test',
      id: 'seeding',
      name: 'records what the runner is handed',
      program: ['x = 1'],
      env: { ContVol: 2.5 },
      megabuf: { '7': 3 },
      gmegabuf: { '0': -1 },
      expected: { x: 1 },
    };
    await runConformance(
      ({ env, megabuf, gmegabuf, random }) => {
        seen.push({
          env: { ...env },
          megabuf: [megabuf[7] as number, megabuf[8] as number],
          gmegabuf: [gmegabuf[0] as number, gmegabuf[1] as number],
          draw: random(),
        });
        env.x = 1;
      },
      { cases: [custom, custom], buffers: shared },
    );
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.env).toEqual({ contvol: 2.5 });
      expect(call.megabuf).toEqual([3, 0]);
      expect(call.gmegabuf).toEqual([-1, 0]);
      expect(call.draw).toBe(EEL_CONFORMANCE_RANDOM_DRAW);
    }
    // The second call saw fresh buffers, not the first call's leftovers.
    expect(shared.megabuf[7]).toBe(3);
  });

  test('refuses buffers shorter than the specification', async () => {
    await expect(
      runConformance(() => {}, {
        buffers: {
          megabuf: new Float32Array(16),
          gmegabuf: new Float32Array(16),
        },
      }),
    ).rejects.toThrow(/at least 1048576 slots/);
  });

  test('provisional failures do not count against conformance', async () => {
    const report = await runConformance(
      ({ env, megabuf, gmegabuf, program }) => {
        const specCase = CASES.find((c) => c.program === program);
        if (specCase?.status === 'provisional') return; // leave it wrong
        oracle({ env, megabuf, gmegabuf, program, random: () => 0.5 });
      },
      { buffers: shared },
    );
    const provisional = CASES.filter((c) => c.status === 'provisional');
    expect(provisional.length).toBeGreaterThan(0);
    expect(report.provisionalFailures).toBeGreaterThan(0);
    expect(report.provisionalFailures).toBeLessThanOrEqual(provisional.length);
    expect(report.pinnedFailures).toBe(0);
    expect(conforms(report)).toBe(true);
    const text = formatReport(report);
    expect(text).toContain('(provisional)');
    expect(text).toContain('Result: conforms');
  });
});

describe('checkCase and seedBuffer', () => {
  test('names the slot that mismatched', () => {
    const specCase: EelConformanceCase = {
      section: 'test',
      id: 'slot',
      name: 'n',
      program: ['megabuf(3) = 7'],
      expected: {},
      expectedMegabuf: { '3': 7 },
    };
    const megabuf = new Float32Array(8);
    megabuf[3] = 6;
    expect(checkCase(specCase, {}, megabuf, new Float32Array(8))).toEqual([
      'megabuf(3): expected 7, got 6',
    ]);
  });

  test('treats an absent variable as 0, so {x: 0} is a real assertion', () => {
    const specCase: EelConformanceCase = {
      section: 'test',
      id: 'zero',
      name: 'n',
      program: ['x = 0'],
      expected: { x: 0 },
    };
    const empty = new Float32Array(1);
    expect(checkCase(specCase, {}, empty, empty)).toEqual([]);
    expect(checkCase(specCase, { x: 1 }, empty, empty)).toEqual([
      'x: expected 0, got 1',
    ]);
  });

  test('seedBuffer zeroes stale slots and ignores out-of-range ones', () => {
    const buffer = new Float32Array(4).fill(9);
    seedBuffer({ '1': 2, '99': 5, '-1': 5 }, buffer);
    expect(Array.from(buffer)).toEqual([0, 2, 0, 0]);
  });
});
