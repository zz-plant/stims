/**
 * Guard against docs that point at files and commands which no longer exist.
 *
 * A doc that names a file after it moved, or tells an agent to run a script
 * after it was deleted, sends the reader somewhere that does not exist.
 * Agents follow instruction files literally, so a dangling reference costs a
 * failed command and a wrong mental model of the tree. Every Markdown file
 * under the configured roots is scanned, plus the named extra files, for two
 * reference kinds: repo paths under the configured prefixes (in backticks,
 * links or plain prose) and `<runner> <script>` invocations, checked against
 * package.json.
 *
 * The exemptions are the config's, each deliberate: historical records that
 * describe a tree as it was, glob-ish references (only the literal directory
 * prefix is verified), documented placeholders, proposal lines that name
 * files a plan would create, paths cited at a historical commit, and
 * generated docs whose prose is already verified where it is authored.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentErgonomicsConfig } from './config.ts';
import type { Command } from './context.ts';
import { readPackageScripts } from './scripts-index.ts';

export type DanglingReference = { file: string; line: number; problem: string };

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function walk(dir: string, skip: Set<string>, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, skip, out);
    else if (full.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Finds every dangling path or script reference under `root`. Paths in the result are relative to it. */
export function findDanglingReferences(
  config: AgentErgonomicsConfig,
  scripts: Record<string, string>,
  root: string,
): DanglingReference[] {
  const { docRefs, runner } = config;
  const prefixes = `(?:${docRefs.pathPrefixes.map(escapeRegExp).join('|')})`;
  // A path after a link target, a backtick, or plain whitespace. The
  // whitespace case matters: `<runner> test tests/foo.test.ts` puts the path
  // inside a code span but not at its start, and prose names files bare.
  const pathRe = new RegExp(
    `(?:\\]\\(\\.{0,2}\\/?|[\`\\s(])(${prefixes}\\/[A-Za-z0-9_\\-./*]*[A-Za-z0-9_\\-*])`,
    'gu',
  );
  const commandRe = new RegExp(`${escapeRegExp(runner)} ([a-z0-9:-]+)`, 'gu');
  const known = new Set(Object.keys(scripts));
  const generated = new Set(docRefs.generatedDocs);
  const skip = new Set(docRefs.skipDirs);

  /** A glob resolves if its literal prefix directory exists. */
  const resolves = (ref: string) => {
    if (!ref.includes('*')) return existsSync(join(root, ref));
    const prefix = ref.slice(0, ref.indexOf('*'));
    const dir = prefix.slice(0, prefix.lastIndexOf('/'));
    return dir.length > 0 && existsSync(join(root, dir));
  };

  const files = [
    ...docRefs.roots.flatMap((dir) =>
      walk(join(root, dir), skip).map((file) => file.slice(root.length + 1)),
    ),
    ...docRefs.extraFiles,
  ];

  const offenders: DanglingReference[] = [];
  for (const file of files) {
    const name = file.split('/').pop() ?? '';
    if (docRefs.historicalRecord.test(name)) continue;
    if (generated.has(file.replaceAll('\\', '/'))) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (docRefs.proposalLine.test(line)) return;
      for (const match of line.matchAll(pathRe)) {
        const ref = match[1] ?? '';
        if (docRefs.placeholder.test(ref) || resolves(ref)) continue;
        // What precedes the path decides whether it is a live reference.
        const before =
          line.slice(0, match.index ?? 0) + match[0].slice(0, -ref.length);
        if (docRefs.historicalPath.test(before)) continue;
        offenders.push({
          file,
          line: index + 1,
          problem: `missing path ${ref}`,
        });
      }
      for (const match of line.matchAll(commandRe)) {
        const script = match[1] ?? '';
        if (known.has(script)) continue;
        offenders.push({
          file,
          line: index + 1,
          problem: `unknown script ${runner} ${script}`,
        });
      }
    });
  }
  return offenders;
}

/** `doc-refs` */
export const runDocReferences: Command = (_args, { config, cwd, io }) => {
  const offenders = findDanglingReferences(
    config,
    readPackageScripts(cwd),
    cwd,
  );
  if (offenders.length > 0) {
    io.error(
      `Found ${offenders.length} dangling reference(s) in agent-facing docs.\n` +
        'Point them at the current file or script, or delete the claim.\n',
    );
    for (const offender of offenders) {
      io.error(`  ${offender.file}:${offender.line} — ${offender.problem}`);
    }
    return 1;
  }
  io.log('✔ doc references resolve to real paths and scripts');
  return 0;
};
