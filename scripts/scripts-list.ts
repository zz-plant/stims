#!/usr/bin/env bun
/**
 * Lists package.json scripts grouped by namespace, pulling each script's
 * one-line purpose from the docblock atop its target file.
 *
 * Run with `bun run scripts:list` (alias `bun run help`). `--json` emits the
 * same index as `{name, command, purpose}` records for tooling and agents;
 * `--check` fails when any script's target file lacks a docblock summary.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const PREFIX_NOTES: Record<string, string> = {
  agent: 'agent-session helpers',
  assets: 'static asset tooling',
  bench: 'benchmarks',
  build: 'production builds',
  catalog: 'catalog tooling',
  check: 'quality gates and guard scripts',
  cron: 'scheduled Worker deploy/dev',
  dev: 'local development servers',
  docs: 'docs generation',
  format: 'Biome formatting',
  generate: 'artifact/doc generators (idempotent; most accept --check)',
  lab: 'preset measurement labs',
  lint: 'Biome linting',
  mcp: 'MCP server deploy/dev',
  model: 'local model routing',
  parity: 'MilkDrop parity corpus pipeline',
  perf: 'perf certification suites',
  previews: 'preset preview generation',
  profile: 'frame profiling',
  session: 'codex session control',
  site: 'site Worker build/deploy pipeline',
  sweep: 'batch preset sweeps',
  test: 'test suite runners (profiles via --profile)',
  typecheck: 'TypeScript no-emit checking',
  ui: 'UI harness tooling',
};

function scriptPurpose(command: string): string | null {
  const match = command.match(/scripts\/([^\s/]+\.(?:ts|mjs|js))/u);
  if (!match) return null;
  let text: string;
  try {
    text = readFileSync(join(ROOT, 'scripts', match[1]), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/u);

  // The block must be file-level, so only look for its opener near the top —
  // otherwise a docblock documenting some interior constant gets read as the
  // script's summary. Its *closer* may be anywhere: the most thoroughly
  // documented scripts have the longest headers, and bounding the search
  // window silently dropped exactly those.
  const start = lines
    .slice(0, 30)
    .findIndex((line) => line.trimStart().startsWith('/**'));
  if (start === -1) return null;

  // Only the first paragraph is needed, so stop at the blank line that ends it
  // rather than requiring the whole block to be in view.
  let paragraph = '';
  for (const raw of lines.slice(start)) {
    const line = raw
      .replace(/^\s*\/?\*+\s?/u, '')
      .replace(/\*\/.*$/u, '')
      .trim();
    const done = raw.includes('*/');
    if (line.startsWith('@')) break;
    if (line.length === 0) {
      if (paragraph) break;
      if (done) break;
      continue;
    }
    paragraph += (paragraph ? ' ' : '') + line;
    if (done) break;
  }

  // Drop a leading `some-script[.ts] — ` restatement; the name is already the
  // first column of the row.
  const base = match[1].replace(/\.(?:ts|mjs|js)$/u, '');
  const selfRef = new RegExp(`^${base}(?:\\.(?:ts|mjs|js))?\\s*[—–-]\\s*`, 'u');
  const summary = paragraph
    .replace(selfRef, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  if (summary.length <= 3) return null;

  // First sentence only — keep the padded column scannable.
  const sentence = /^(.+?[.!?])(?:\s|$)/u.exec(summary);
  return sentence ? sentence[1] : summary;
}

const bare: Array<[string, string]> = [];
const groups = new Map<string, Array<[string, string]>>();

for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
  const entry: [string, string] = [name, command];
  const colon = name.indexOf(':');
  if (colon === -1) {
    bare.push(entry);
  } else {
    const prefix = name.slice(0, colon);
    const bucket = groups.get(prefix) ?? [];
    bucket.push(entry);
    groups.set(prefix, bucket);
  }
}

const pad = (list: Array<[string, string]>) => {
  const width = Math.max(...list.map(([name]) => name.length));
  return list.map(([name, command]) => {
    const purpose = summarize(command);
    return `  ${name.padEnd(width)}  ${purpose ?? command}`;
  });
};

const scriptCount =
  bare.length + [...groups.values()].reduce((n, g) => n + g.length, 0);

const targetFile = (command: string) =>
  command.match(/scripts\/([^\s/]+\.(?:ts|mjs|js))/u)?.[1] ?? null;

// Several names point at one script and differ only by flags (`test:corpus` vs
// `test:fast`). They'd otherwise render as identical rows, so the flags — the
// only thing that distinguishes them — get appended.
const fileUsage = new Map<string, number>();
for (const [, command] of [...bare, ...[...groups.values()].flat()]) {
  const file = targetFile(command);
  if (file) fileUsage.set(file, (fileUsage.get(file) ?? 0) + 1);
}

function summarize(command: string): string | null {
  const purpose = scriptPurpose(command);
  if (!purpose) return null;
  const file = targetFile(command);
  if (!file || (fileUsage.get(file) ?? 0) < 2) return purpose;
  const args = command.slice(command.indexOf(file) + file.length).trim();
  if (!args) return purpose;
  const shown = args.length > 48 ? `${args.slice(0, 47).trimEnd()}…` : args;
  return `${purpose} [${shown}]`;
}

const describe = ([name, command]: [string, string]) => ({
  name,
  command,
  purpose: summarize(command),
});

if (process.argv.includes('--check')) {
  // A script whose target file has no docblock shows its raw shell command in
  // the listing, which is exactly the discoverability gap this index exists to
  // close. Fail so the gap is fixed at the source rather than accumulating.
  const undocumented = [...bare, ...[...groups.values()].flat()]
    .filter(([, command]) => /scripts\/[^\s/]+\.(?:ts|mjs|js)/u.test(command))
    .filter(([, command]) => scriptPurpose(command) === null)
    .map(([name]) => name);

  if (undocumented.length > 0) {
    console.error(
      `${undocumented.length} script(s) have no docblock summary, so \`bun run help\` shows their raw command:\n`,
    );
    for (const name of undocumented) console.error(`  ${name}`);
    console.error(
      '\nAdd a `/** … */` block atop the target file in scripts/. The first paragraph becomes the summary.',
    );
    process.exit(1);
  }
  console.log(`All ${scriptCount} scripts resolve to a docblock summary.`);
} else if (process.argv.includes('--json')) {
  const json: Record<string, unknown> = {
    bare: bare.map(describe),
    groups: Object.fromEntries(
      [...groups].map(([prefix, entries]) => [
        prefix,
        { note: PREFIX_NOTES[prefix] ?? null, scripts: entries.map(describe) },
      ]),
    ),
  };
  console.log(JSON.stringify(json, null, 2));
} else {
  console.log(
    `Stims scripts (${scriptCount}) — run any with \`bun run <name>\`.\n`,
  );

  console.log('Top-level:');
  console.log(pad(bare).join('\n'));

  for (const [prefix, entries] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const note = PREFIX_NOTES[prefix] ?? prefix;
    console.log(`\n${prefix}: — ${note}`);
    console.log(pad(entries).join('\n'));
  }
}
