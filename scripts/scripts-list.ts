#!/usr/bin/env bun
/**
 * Lists package.json scripts grouped by namespace, pulling each script's
 * one-line purpose from the docblock atop its target file.
 *
 * Run with `bun run scripts:list` (alias `bun run help`). `--json` emits the
 * same index as `{name, command, purpose}` records for tooling and agents;
 * `--check` fails when any script's target file lacks a docblock summary.
 *
 * `--for "<symptom>"` answers the question the plain listing cannot: not
 * "what scripts exist" but "which one answers what I am actually asking".
 * With 131 scripts, knowing an instrument exists is not the same as knowing
 * it is the right one, and picking wrong costs an afternoon. Curated routes
 * come first because the best answer is often a script whose name shares no
 * words with the symptom ("my preset looks wrong" -> `parity:capture`);
 * keyword matching over the docblock index is the fallback.
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

/**
 * Symptom -> instrument routes, in the words someone would actually use.
 *
 * Hand-maintained on purpose: these encode which measurement answers which
 * question, which is exactly the tacit knowledge a generated index cannot
 * capture. `check:doc-references` does not cover this file, so the smoke test
 * in `tests/unit/scripts-list-routing.test.ts` asserts every command named here
 * still exists.
 */
const ROUTES: Array<{ when: string[]; run: string[]; note: string }> = [
  {
    when: [
      'preset looks wrong',
      'wrong',
      'fidelity',
      'different',
      'inaccurate',
      'parity',
    ],
    run: ['parity:capture', 'parity:diff'],
    note: "Ground truth lives outside this repo, in MilkDrop's actual behavior. Capture a reference and diff frames — do not write a unit test asserting what you think is correct.",
  },
  {
    when: ['not reacting', 'audio', 'reactivity', 'music', 'beat', 'quiet'],
    run: ['lab:reactivity', 'lab:visual'],
    note: 'lab:reactivity is ~15s and needs no browser; lab:visual (1-3 min) confirms the reaction is visible in pixels, not just in the numbers.',
  },
  {
    when: [
      'nan',
      'black',
      'blank',
      'frozen',
      'crash',
      'compile',
      'broken preset',
    ],
    run: ['lab:nan-sweep', 'sweep:milkdrop-loops'],
    note: 'nan-sweep finds NaN/compile/step failures corpus-wide without a browser; sweep:milkdrop-loops finds presets that render blank, frozen or slow.',
  },
  {
    when: [
      'webgpu',
      'webgl',
      'backend',
      'differs',
      'gpu',
      'divergence',
      'tier',
      'mirrored',
      'flipped',
      'upside down',
      'tone mapped',
    ],
    run: ['lab:backend-diff', 'lab:gpu-differential', 'lab:replay'],
    note: 'Reach for lab:backend-diff first: it is the only one that compares RENDERED FRAMES across the two backends, scoring each preset against its own same-backend noise floor and naming a mirrored frame or a constant colour shift outright. lab:gpu-differential and lab:replay --tier gpu compare VM execution tiers instead, and name the first divergent frame once you know the backends disagree.',
  },
  {
    when: [
      'vm',
      'semantics',
      'expression',
      'eel',
      'changed behavior',
      'regression',
    ],
    run: ['lab:replay'],
    note: 'Record a trace before your edit, replay after. Bisects semantic drift to a frame instead of leaving you to eyeball it.',
  },
  {
    when: ['slow', 'fps', 'performance', 'frame', 'budget', 'jank', 'stutter'],
    run: ['perf:certification-corpus', 'profile:frame', 'bench:butterchurn'],
    note: 'Measure before optimising; intuition about which loop dominates a frame is usually wrong.',
  },
  {
    when: ['flash', 'seizure', 'photosensitive', 'strobe', 'wcag', 'safety'],
    run: ['lab:flash-audit'],
    note: 'lab:flash-audit (~12 min) is the real WCAG 2.3.1 instrument. lab:flash-risk is a rough placeholder heuristic and is not a compliance check.',
  },
  {
    when: ['ui', 'css', 'layout', 'visual regression', 'chrome', 'panel'],
    run: ['ui:diff', 'dev'],
    note: 'ui:diff screenshot-diffs the workspace. For live QA use bun run dev and open /?agent=true.',
  },
  {
    when: ['rule', 'guard', 'rejected', 'gate', 'lint', 'why did check fail'],
    run: ['check:quick'],
    note: 'docs/GUARDRAILS.md lists every enforced rule and its rationale, generated from the guards themselves.',
  },
  {
    when: ['where do i start', 'onboard', 'new', 'learn', 'confused'],
    run: ['help'],
    note: 'docs/ONBOARDING.md maps which parts of the codebase are hard, why, and what order to learn them in.',
  },
];

const forIndex = process.argv.indexOf('--for');
if (forIndex !== -1) {
  const query = process.argv
    .slice(forIndex + 1)
    .join(' ')
    .toLowerCase()
    .trim();
  if (!query) {
    console.error('Usage: bun run help --for "my preset looks wrong"');
    process.exit(1);
  }

  const scored = ROUTES.map((route) => {
    const hits = route.when.filter((term) => query.includes(term)).length;
    const loose = route.when.filter((term) =>
      term.split(' ').some((word) => word.length > 3 && query.includes(word)),
    ).length;
    return { route, score: hits * 10 + loose };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    console.log(`\nFor "${query}":\n`);
    for (const { route } of scored.slice(0, 3)) {
      for (const name of route.run) {
        const command = pkg.scripts?.[name];
        const purpose = command ? summarize(command) : null;
        console.log(`  bun run ${name}`);
        if (purpose) console.log(`      ${purpose}`);
      }
      console.log(`      ↳ ${route.note}\n`);
    }
    process.exit(0);
  }

  // No curated route matched; fall back to the generated index.
  const words = query.split(/\s+/u).filter((word) => word.length > 3);
  const matches = [...bare, ...[...groups.values()].flat()]
    .map(([name, command]) => ({ name, purpose: summarize(command) }))
    .filter(({ name, purpose }) => {
      const haystack = `${name} ${purpose ?? ''}`.toLowerCase();
      return words.some((word) => haystack.includes(word));
    })
    .slice(0, 8);

  if (matches.length === 0) {
    console.log(
      `\nNo route for "${query}".\n\n` +
        '  bun run help                 every script, grouped\n' +
        '  docs/ONBOARDING.md           which areas are hard, and in what order\n' +
        '  docs/GUARDRAILS.md           every rule this repo enforces\n',
    );
    process.exit(0);
  }

  console.log(`\nNo curated route for "${query}". Closest by keyword:\n`);
  for (const { name, purpose } of matches) {
    console.log(`  bun run ${name}`);
    if (purpose) console.log(`      ${purpose}`);
  }
  console.log();
  process.exit(0);
}

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
