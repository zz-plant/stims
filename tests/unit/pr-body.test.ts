import { describe, expect, test } from 'bun:test';
import { buildPrBody, validatePrBody } from '../../scripts/pr-body.ts';

const TEMPLATE = `<!-- header comment -->

## Summary

<!-- What changed. -->

## Testing

-

## Review risk checklist

- [x] Null/undefined paths reviewed for changed logic
- [ ] Behavior change is covered by tests

## Quality checklist

- [X] \`bun run check:quick\`
- [ ] \`bun run build\`
`;

const scaffold = (files: string[], footer?: string) =>
  buildPrBody({
    commits: ['feat: a', 'fix: b'],
    files,
    template: TEMPLATE,
    footer,
  });

describe('scaffold', () => {
  test('lists the changed tests and docs it can actually see', () => {
    const body = scaffold([
      'src/js/a.ts',
      'tests/unit/a.test.ts',
      'docs/agents/x.md',
      '.claude/CLAUDE.md',
    ]);
    expect(body).toContain('`tests/unit/a.test.ts`');
    expect(body).toContain('- `docs/agents/x.md`');
    expect(body).toContain('- `.claude/CLAUDE.md`');
    expect(body).not.toContain('src/js/a.ts');
  });

  test('says None for docs and asks why when no test changed', () => {
    const body = scaffold(['src/js/a.ts']);
    expect(body).toContain('## Docs touched\n\nNone');
    expect(body).toContain('no test files changed');
  });

  test('never ticks a checklist box, even one the template had ticked', () => {
    const body = scaffold(['tests/unit/a.test.ts']);
    expect(body).toContain('- [ ] Null/undefined paths reviewed');
    expect(body).toContain('- [ ] `bun run check:quick`');
    expect(body).not.toMatch(/\[[xX]\]/);
  });

  test('appends a footer verbatim and tolerates a missing template', () => {
    expect(scaffold([], '🤖 footer').trimEnd().endsWith('🤖 footer')).toBe(
      true,
    );
    const bare = buildPrBody({ commits: ['x'], files: [], template: null });
    expect(bare).toContain('## Summary');
    expect(bare).not.toContain('checklist');
  });
});

describe('validation mirrors CI', () => {
  test('an untouched scaffold fails, on its TODOs', () => {
    const errors = validatePrBody(scaffold(['tests/unit/a.test.ts']));
    expect(errors.join('\n')).toContain('TODO');
  });

  test('a finished body with a command and a result passes', () => {
    const body =
      '## Summary\n\nFixes the flake.\n\n## Testing\n\n- `bun run test tests/unit/a.test.ts` → 3 pass\n';
    expect(validatePrBody(body)).toEqual([]);
  });

  test('empty and placeholder bodies fail', () => {
    expect(validatePrBody('').join()).toContain('empty');
    expect(validatePrBody('TBD').join()).toContain('empty');
    expect(validatePrBody('<!-- only a comment -->').join()).toContain('empty');
  });

  test('a body that never says how it was verified fails', () => {
    const errors = validatePrBody('## Summary\n\nChanged some things around.');
    expect(errors.join()).toContain('how you know');
  });

  test('a measurement alone counts as evidence, as in CI', () => {
    expect(validatePrBody('Cut the frame from 40 ms to 12 ms.')).toEqual([]);
  });
});
