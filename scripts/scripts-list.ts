#!/usr/bin/env bun
/**
 * Lists package.json scripts grouped by namespace, pulling each script's
 * one-line purpose from the docblock atop its target file.
 *
 * Run with `bun run scripts:list` (alias `bun run help`). `--json` emits a
 * machine-readable group map for tooling.
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
  const lines = text.split(/\r?\n/u).slice(0, 30);
  const start = lines.findIndex((line) => line.trimStart().startsWith('/**'));
  if (start === -1) return null;
  const block = lines.slice(start).join('\n');
  const end = block.indexOf('*/');
  if (end === -1) return null;
  const summary = block
    .slice(0, end)
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\/?\*+\s?/u, '').trim())
    .find((line) => line.length > 3 && !line.startsWith('@'));
  return summary ?? null;
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
    const purpose = scriptPurpose(command);
    return `  ${name.padEnd(width)}  ${purpose ?? command}`;
  });
};

if (process.argv.includes('--json')) {
  const json: Record<string, unknown> = {
    bare: Object.fromEntries(bare),
    groups: Object.fromEntries(
      [...groups].map(([prefix, entries]) => [
        prefix,
        Object.fromEntries(entries),
      ]),
    ),
  };
  console.log(JSON.stringify(json, null, 2));
} else {
  const total =
    bare.length + [...groups.values()].reduce((n, g) => n + g.length, 0);
  console.log(`Stims scripts (${total}) — run any with \`bun run <name>\`.\n`);

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
