import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigError,
  collectIo,
  loadConfig,
  parseDocblock,
  resolveConfig,
  runCli,
} from '../src/index.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-ergonomics-'));
  roots.push(root);
  return root;
};

test('config applies defaults and rejects unknown fields and bare exemptions', () => {
  expect(resolveConfig({}).gate.quietEnv).toBe('AGENT_ERGONOMICS_QUIET');
  for (const input of [
    { hepl: {} },
    { gate: { concurent: [] } },
    { testSourceGreps: { allowed: { 'tests/a.test.ts': '' } } },
    { moduleDocs: { minLines: -1 } },
  ]) {
    expect(() => resolveConfig(input)).toThrow(ConfigError);
  }
  expect(() => resolveConfig({ docRefs: { historicalRecord: '[' } })).toThrow(
    'docRefs.historicalRecord',
  );
});

test('config loading resolves explicit JSON and discovered TS files from the selected root', async () => {
  const root = fixture();
  writeFileSync(
    join(root, 'custom.json'),
    JSON.stringify({ help: { title: 'Fixture scripts' } }),
  );
  expect((await loadConfig('custom.json', root)).config.help.title).toBe(
    'Fixture scripts',
  );
  writeFileSync(
    join(root, 'agent-ergonomics.config.ts'),
    'export default { runner: "npm run" };',
  );
  expect((await loadConfig(undefined, root)).config.runner).toBe('npm run');
  writeFileSync(join(root, 'invalid.json'), '{');
  await expect(loadConfig('invalid.json', root)).rejects.toThrow(
    'could not parse JSON',
  );
  await expect(loadConfig('missing.json', root)).rejects.toThrow(
    'no config file',
  );
});

test('shared docblock parser preserves inline text, paragraphs and configured opener bounds', () => {
  expect(parseDocblock('/** First line. */')?.summary).toBe('First line.');
  const block = parseDocblock(
    '#!/usr/bin/env bun\r\n/**\r\n * First\r\n * paragraph.\r\n *\r\n * Why it exists.\r\n */',
  );
  expect(block?.summary).toBe('First paragraph.');
  expect(block?.rest).toBe('Why it exists.');
  expect(parseDocblock('/** Summary.\n * @example use it\n */')?.summary).toBe(
    'Summary.',
  );
  const late = `${'\n'.repeat(12)}/** Late summary. */`;
  expect(parseDocblock(late)).toBeNull();
  expect(parseDocblock(late, { openerWithin: 30 })?.summary).toBe(
    'Late summary.',
  );
});

test('CLI loads one config and dispatches help and read-only guards in another repository', async () => {
  const root = fixture();
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { 'check:sample': 'bun tools/sample.ts' } }),
  );
  writeFileSync(
    join(root, 'tools/sample.ts'),
    '/** Checks a fixture contract.\n *\n * Explains the incident.\n */',
  );
  writeFileSync(join(root, 'docs/guide.md'), 'Use `bun run check:sample`.');
  writeFileSync(
    join(root, 'agent-ergonomics.config.json'),
    JSON.stringify({
      scriptsDir: 'tools',
      help: { title: 'Fixture scripts' },
      guardrails: { output: 'docs/guards.md' },
    }),
  );
  const io = collectIo();
  expect(await runCli(['help', '--json'], { cwd: root, io })).toBe(0);
  expect(JSON.parse(io.logged.join('\n')).groups.check.scripts[0].purpose).toBe(
    'Checks a fixture contract.',
  );
  expect(await runCli(['guardrails'], { cwd: root, io })).toBe(0);
  expect(await runCli(['guardrails', '--check'], { cwd: root, io })).toBe(0);
  expect(await runCli(['doc-refs'], { cwd: root, io })).toBe(0);
  expect(await runCli(['module-docs'], { cwd: root, io })).toBe(0);
  expect(await runCli(['test-source-greps'], { cwd: root, io })).toBe(0);
});

test('CLI explains missing config, unknown commands and global help without throwing', async () => {
  const root = fixture();
  const io = collectIo();
  expect(await runCli(['--help'], { cwd: root, io })).toBe(0);
  expect(io.logged.join('\n')).toContain('branch-restart');
  expect(await runCli(['unknown'], { cwd: root, io })).toBe(2);
  expect(await runCli(['help'], { cwd: root, io })).toBe(2);
  expect(io.errored.join('\n')).toContain('no config found');
});

test('CLI refuses inherited object names even when the configuration is valid', async () => {
  const root = fixture();
  writeFileSync(join(root, 'agent-ergonomics.config.json'), '{}');
  const io = collectIo();
  expect(await runCli(['constructor'], { cwd: root, io })).toBe(2);
  expect(await runCli(['toString'], { cwd: root, io })).toBe(2);
});

test('commit and PR checks accept absolute file paths outside the repository', async () => {
  const root = fixture();
  const outside = fixture();
  writeFileSync(join(root, 'agent-ergonomics.config.json'), '{}');
  const message = join(outside, 'message.txt');
  const body = join(outside, 'pr.md');
  writeFileSync(message, 'fix: handle missing input');
  writeFileSync(body, '## Testing\n\n- bun run test passed.');
  const io = collectIo();
  expect(await runCli(['commit-msg', message], { cwd: root, io })).toBe(0);
  expect(await runCli(['pr-body', '--check', body], { cwd: root, io })).toBe(0);
});

test('PR scaffolding writes through the caller output sink and leaves checks unticked', async () => {
  const root = fixture();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), 'Base.');
  git('add', '.');
  git('commit', '-qm', 'chore: initial fixture');
  writeFileSync(join(root, 'README.md'), 'Changed.');
  git('add', '.');
  git('commit', '-qm', 'docs: explain the fixture');
  writeFileSync(join(root, 'agent-ergonomics.config.json'), '{}');
  const io = collectIo();
  expect(await runCli(['pr-body', '--base', 'HEAD^'], { cwd: root, io })).toBe(0);
  expect(io.logged.join('\n')).toContain('## Summary');
  expect(io.logged.join('\n')).not.toContain('[x]');
});
