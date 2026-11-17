/**
 * Behavioural coverage for the objection-copy rule in check:readme-claims.
 *
 * Copy that answers a doubt nobody raised plants that doubt, so the guard
 * flags it unless the sentence names a row of docs/objections.md, the ledger
 * of objections visitors did raise. These run the exported validator against
 * fixture files in a temporary root, so they exercise the same matching the
 * quality gate runs.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateObjectionCopy } from '../../scripts/check-readme-claims.ts';

const LEDGER_HEADER = `# Objections visitors have raised

| id | Objection, as a visitor put it | Evidence | Where the copy answers it |
| --- | --- | --- | --- |
`;

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

async function check(files: Record<string, string>, ledgerRows = '') {
  root = mkdtempSync(join(tmpdir(), 'objection-copy-'));
  const all = { 'docs/objections.md': LEDGER_HEADER + ledgerRows, ...files };
  for (const [file, contents] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  const issues: string[] = [];
  await validateObjectionCopy(issues, root);
  return issues;
}

describe('check:readme-claims objection copy', () => {
  test('flags a sentence that answers a doubt nobody raised', async () => {
    const issues = await check({
      'README.md':
        "You might be wondering whether it costs money. Don't worry: it is free.\n",
    });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('README.md:1');
    expect(issues.join('\n')).toContain('mind-reading');
    expect(issues.join('\n')).toContain('reassurance');
  });

  test('flags a negation opener and a string in TypeScript copy', async () => {
    const issues = await check({
      'src/js/frontend/Hero.tsx':
        'export const Hero = () => <p>Not a toy. A real visualizer.</p>;\n',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('negation opener');
  });

  test('passes copy that states what the thing does', async () => {
    const issues = await check({
      'README.md': 'Stims plays MilkDrop presets in a browser tab.\n',
      'src/js/frontend/Hero.tsx':
        '// Not another hero: a comment a visitor never reads.\nexport const x = 1;\n',
    });
    expect(issues).toEqual([]);
  });

  test('passes a marked sentence whose id is in the ledger', async () => {
    const row =
      '| cost | "Is this going to charge me later?" | Issue #1, 2026-11-01 | README intro |\n';
    const issues = await check(
      {
        'README.md':
          "Don't worry about cost: it is free. <!-- objection: cost -->\n",
        'src/js/frontend/Hero.tsx':
          '// objection: cost\nexport const s = "Don\'t worry, it is free.";\n',
      },
      row,
    );
    expect(issues).toEqual([]);
  });

  test('rejects a marker naming an id the ledger does not have', async () => {
    const issues = await check({
      'README.md':
        "Don't worry about cost: it is free. <!-- objection: cost -->\n",
    });
    expect(
      issues.some((issue) => issue.includes('names objection "cost"')),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes('reassurance'))).toBe(true);
  });
});
