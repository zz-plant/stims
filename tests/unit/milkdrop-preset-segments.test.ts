/**
 * Catalog-wide round-trip for the block-aware source model — the same
 * enumeration contract as tests/unit/catalog-compiler-smoke.test.ts: a
 * non-recursive readdir covers only a fraction of the catalog, so the sweep
 * must stay recursive to mean anything.
 *
 * Splitting every bundled preset into equation and shader segments must lose
 * nothing: printing the segments back yields each file byte for byte, and
 * the segment bounds stay contiguous line runs of the real file (no phantom
 * trailing line, no gaps, no overlaps). This is what the shader-block editor
 * builds its edits on, so a preset that fails here cannot be edited safely.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type MilkdropPresetSegment,
  printMilkdropPresetSegments,
  splitMilkdropPresetSegments,
} from 'milkdrop-toolchain/src/preset-segments.ts';

const PRESET_DIR = join(process.cwd(), 'public/milkdrop-presets');

type CatalogEntry = {
  id: string;
  raw: string;
  segments: MilkdropPresetSegment[];
};

let catalog: CatalogEntry[] = [];

beforeAll(() => {
  catalog = readdirSync(PRESET_DIR, { recursive: true })
    .map(String)
    .filter((entry) => entry.toLowerCase().endsWith('.milk'))
    .map((entry) => {
      const raw = readFileSync(join(PRESET_DIR, entry), 'utf8');
      return {
        id: entry.replace(/\.milk$/i, ''),
        raw,
        segments: splitMilkdropPresetSegments(raw),
      };
    });
}, 60_000);

describe('catalog preset segment round-trip', () => {
  test('covers the whole bundled catalog, not just the top-level directory', () => {
    expect(catalog.length).toBeGreaterThan(1500);
  });

  test('every preset reassembles byte for byte', () => {
    const failures = catalog
      .filter(
        (entry) => printMilkdropPresetSegments(entry.segments) !== entry.raw,
      )
      .map((entry) => entry.id);
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures.length).toBe(0);
  });

  test('segment line bounds partition each preset contiguously', () => {
    const violations: string[] = [];
    for (const entry of catalog) {
      if (entry.raw === '') {
        if (entry.segments.length !== 0) {
          violations.push(`${entry.id}: empty source split into segments`);
        }
        continue;
      }
      const lineCount = entry.raw.split(/\r?\n/u).length;
      let expectedStart = 1;
      for (const segment of entry.segments) {
        if (segment.startLine !== expectedStart) {
          violations.push(
            `${entry.id}: segment starts at ${segment.startLine}, expected ${expectedStart}`,
          );
          break;
        }
        if (segment.endLine < segment.startLine) {
          violations.push(
            `${entry.id}: empty segment at line ${segment.startLine}`,
          );
          break;
        }
        // The phantom element a trailing terminator produces is not a line.
        if (segment.endLine > lineCount - (entry.raw.endsWith('\n') ? 1 : 0)) {
          violations.push(
            `${entry.id}: segment ends at ${segment.endLine} of ${lineCount} lines`,
          );
          break;
        }
        expectedStart = segment.endLine + 1;
      }
      if (
        expectedStart !==
        lineCount - (entry.raw.endsWith('\n') ? 1 : 0) + 1
      ) {
        violations.push(
          `${entry.id}: segments cover ${expectedStart - 1} of the file`,
        );
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  test('the catalog actually exercises shader blocks', () => {
    const withBoth = catalog.filter(
      (entry) =>
        entry.segments.some((s) => s.kind === 'shader' && s.stage === 'warp') &&
        entry.segments.some((s) => s.kind === 'shader' && s.stage === 'comp'),
    );
    const without = catalog.filter(
      (entry) => !entry.segments.some((s) => s.kind === 'shader'),
    );
    // Guards the sweep itself: if section headers stopped parsing as shader
    // blocks, the two numbers below would collapse to zero and ~1787 and
    // every other assertion here would keep passing while covering nothing.
    expect(withBoth.length).toBeGreaterThan(900);
    expect(without.length).toBeGreaterThan(400);
  });

  test('each shader segment begins with its own section header', () => {
    const violations: string[] = [];
    for (const entry of catalog) {
      const lines = entry.raw.split(/\r?\n/u);
      for (const segment of entry.segments) {
        if (segment.kind !== 'shader') continue;
        const header = lines[segment.startLine - 1]?.trim().toLowerCase() ?? '';
        const expected =
          segment.stage === 'warp' ? '[warp_shader]' : '[comp_shader]';
        if (header !== expected) {
          violations.push(
            `${entry.id}: ${segment.stage} segment starts with "${header}"`,
          );
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});
