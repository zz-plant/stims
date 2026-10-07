/**
 * The corpus is data, and data drifts. These tests pin the properties other
 * implementations rely on: stable, unique, well-formed ids; every case
 * asserting something; the schema and the TypeScript type agreeing on which
 * keys exist; and the section ids matching the files they live in.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCaseShape } from '../src/cli.ts';
import {
  EEL_CONFORMANCE_BUFFER_SLOTS,
  EEL_CONFORMANCE_CASES_DIR,
  EEL_CONFORMANCE_RANDOM_DRAW,
  eelConformanceTolerance,
  loadEelCaseGroups,
  loadEelConformanceCases,
  pinnedCases,
  provisionalCases,
  qualifiedId,
  withinTolerance,
} from '../src/index.ts';

const GROUPS = loadEelCaseGroups();
const CASES = loadEelConformanceCases();

describe('corpus layout', () => {
  test('has at least the nine sections the README describes', () => {
    expect(GROUPS.length).toBeGreaterThanOrEqual(9);
    expect(CASES.length).toBeGreaterThanOrEqual(82);
  });

  test('every section id matches its file name after the numeric prefix', () => {
    for (const group of GROUPS) {
      const stem = group.file.replace(/^\d+-/, '').replace(/\.json$/, '');
      expect(group.section).toBe(stem);
    }
  });

  test('every group has a description', () => {
    for (const group of GROUPS) {
      expect(group.description.length).toBeGreaterThan(20);
    }
  });

  test('qualified ids are unique across the whole corpus', () => {
    const ids = CASES.map(qualifiedId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every case passes the shape checks that mirror schema.json', () => {
    const problems = CASES.flatMap(validateCaseShape);
    expect(problems).toEqual([]);
  });

  test('pinned and provisional partition the corpus', () => {
    expect(pinnedCases().length + provisionalCases().length).toBe(CASES.length);
    expect(provisionalCases().length).toBeGreaterThan(0);
    for (const c of provisionalCases()) expect(c.status).toBe('provisional');
  });

  test('every provisional case explains itself in a note', () => {
    for (const c of provisionalCases()) {
      expect(c.note?.length ?? 0).toBeGreaterThan(40);
    }
  });

  test('the loader rejects a case that asserts nothing', () => {
    // Build a one-file corpus in a temp dir with no assertions.
    const dir = join(
      process.env.TMPDIR ?? '/tmp',
      `eel-conformance-empty-${process.pid}`,
    );
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '01-x.json'),
      JSON.stringify({
        section: 'x',
        description: 'd',
        cases: [{ id: 'a', name: 'n', program: ['x = 1'], expected: {} }],
      }),
    );
    try {
      expect(() => loadEelCaseGroups(dir)).toThrow(/asserts nothing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('schema and type agree', () => {
  const schema = JSON.parse(
    readFileSync(join(EEL_CONFORMANCE_CASES_DIR, '..', 'schema.json'), 'utf8'),
  ) as {
    definitions: {
      case: { properties: Record<string, unknown>; required: string[] };
    };
    properties: Record<string, unknown>;
  };

  test('schema case properties are exactly the keys the loader understands', () => {
    const schemaKeys = Object.keys(schema.definitions.case.properties).sort();
    expect(schemaKeys).toEqual(
      [
        'id',
        'name',
        'program',
        'env',
        'megabuf',
        'gmegabuf',
        'expected',
        'expectedMegabuf',
        'expectedGmegabuf',
        'note',
        'status',
      ].sort(),
    );
    expect(schema.definitions.case.required.sort()).toEqual(
      ['id', 'name', 'program', 'expected'].sort(),
    );
  });

  test('every case file declares the schema', () => {
    for (const group of GROUPS) {
      const raw = JSON.parse(
        readFileSync(join(EEL_CONFORMANCE_CASES_DIR, group.file), 'utf8'),
      ) as { $schema?: string };
      expect(raw.$schema).toBe('../schema.json');
    }
  });
});

describe('specification constants', () => {
  test('buffers are a mebibyte of f32 slots and the random draw is one half', () => {
    expect(EEL_CONFORMANCE_BUFFER_SLOTS).toBe(1 << 20);
    expect(EEL_CONFORMANCE_RANDOM_DRAW).toBe(0.5);
  });

  test('tolerance is absolute near zero and relative away from it', () => {
    expect(eelConformanceTolerance(0)).toBe(1e-12);
    expect(eelConformanceTolerance(1e6)).toBeCloseTo(1e-3, 6);
    expect(withinTolerance(1e6 + 5e-4, 1e6)).toBe(true);
    expect(withinTolerance(1e6 + 2e-3, 1e6)).toBe(false);
    expect(withinTolerance(1e-13, 0)).toBe(true);
    expect(withinTolerance(1e-11, 0)).toBe(false);
  });

  test('every expected buffer slot lies inside the declared buffer', () => {
    for (const c of CASES) {
      for (const field of ['expectedMegabuf', 'expectedGmegabuf'] as const) {
        for (const slot of Object.keys(c[field] ?? {})) {
          const index = Number(slot);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(EEL_CONFORMANCE_BUFFER_SLOTS);
        }
      }
    }
  });
});
