/**
 * Fails when a test reads a production source file as text.
 *
 * The shape it catches:
 *
 *   const source = readFileSync('src/js/frontend/X.tsx', 'utf8');
 *   expect(source).toContain('<a literal copied out of X.tsx>');
 *
 * That assertion cannot fail when behaviour changes and cannot pass when the
 * behaviour is right but the spelling moved. Renaming a local, extracting a
 * component, or reformatting a selector reddens the suite while the app is
 * identical; putting the same literal in a comment turns it green while the
 * feature is gone. Tests like this also keep dead code alive, because
 * deleting the code correctly is what breaks them.
 *
 * The rule: assert through the module's exported behaviour instead. If the
 * property really is about a file's text — a shipped HTML artifact, a config
 * file, a generated header — allowlist it in the config with a reason. That
 * one-line edit with a justification is the cost this guard imposes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AgentErgonomicsConfig } from './config.ts';
import type { Command } from './context.ts';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/** Test files (relative to `root`) that read a source directory as text and are not allowlisted. */
export function findSourceGreps(
  config: AgentErgonomicsConfig['testSourceGreps'],
  root: string,
): string[] {
  const dirs = config.sourceDirs.map(escapeRegExp).join('|');
  const readsSource = new RegExp(
    `(?:readFileSync|readFile|Bun\\.file)\\s*\\([^)]*?['"\`][^'"\`]*?(?:^|\\/|\\.\\.\\/)(?:${dirs})\\/`,
    'u',
  );
  const testsDir = path.join(root, config.testsDir);
  if (!fs.existsSync(testsDir)) return [];
  const offenders: string[] = [];
  for (const file of walk(testsDir)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel in config.allowed) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (readsSource.test(source)) offenders.push(rel);
  }
  return offenders;
}

/** `test-source-greps` */
export const runTestSourceGreps: Command = (
  _args,
  { config, cwd, io, configPath },
) => {
  const { testSourceGreps } = config;
  const offenders = findSourceGreps(testSourceGreps, cwd);
  const dirs = testSourceGreps.sourceDirs.map((dir) => `${dir}/`).join(' or ');
  const where = configPath
    ? path.relative(cwd, configPath)
    : 'the agent-ergonomics config';
  if (offenders.length > 0) {
    io.error(
      `✖ ${offenders.length} test file(s) read production source as text:\n` +
        offenders.map((f) => `  ${f}`).join('\n') +
        `\n\nA test that greps ${dirs} cannot fail when behaviour changes,` +
        '\nand cannot pass when the behaviour is right but the spelling moved.' +
        '\nAssert through the module instead, or add an allowlist entry with a' +
        `\nreason in ${where}.`,
    );
    return 1;
  }
  const reasons = Object.values(testSourceGreps.allowed);
  const debt = reasons.filter((r) =>
    r.startsWith(testSourceGreps.debtPrefix),
  ).length;
  io.log(
    `✔ no new source-text tests (${debt} allowlisted as known debt, ${reasons.length - debt} as shipped-artifact reads)`,
  );
  return 0;
};
