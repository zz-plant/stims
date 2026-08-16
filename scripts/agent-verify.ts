/**
 * Smart verification gate for agents.
 *
 * Given the changed files (git diff vs the merge base of origin/main, or
 * explicit paths), run exactly the guards and tests those changes can break,
 * and print regenerate hints. Agents get a one-command answer to "what do I
 * need to verify for this edit?" instead of reading every guard's scope.
 *
 * Usage:
 *   bun run agent:verify --changed          # diff vs origin/main (fallback: HEAD)
 *   bun run agent:verify <path...>          # explicit changed paths
 *
 * Rule guards are subsumed by `check:quick` when code changed, because quick
 * already runs the metadata/architecture/claim-drift guards concurrently.
 */

import { $ } from 'bun';

type Rule = {
  match: string[];
  guards?: string[];
  tests?: string[];
  regens?: string[];
};

const RULES: Rule[] = [
  {
    match: ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', '.github/', 'docs/'],
    guards: ['check:doc-references', 'check:readme-claims'],
  },
  {
    match: ['docs/authoring/reference.md'],
    guards: ['check:authoring-docs'],
  },
  {
    match: [
      'src/js/milkdrop/compiler/expression.ts',
      'src/js/milkdrop/builtin-docs.ts',
    ],
    guards: ['check:authoring-docs'],
    regens: ['docs:authoring-reference'],
  },
  {
    match: ['public/milkdrop-presets/catalog.json'],
    guards: ['check:catalog-integrity', 'check:catalog-fidelity'],
  },
  {
    match: ['public/milkdrop-presets/'],
    guards: ['check:catalog-integrity'],
  },
  {
    match: ['src/js/frontend/'],
    guards: ['check:architecture'],
  },
  {
    match: ['package.json', 'wrangler.', '.github/workflows/'],
    guards: ['check:ci-config'],
  },
];

async function getChangedFiles(explicit: string[]): Promise<string[]> {
  if (explicit.length > 0) return [...new Set(explicit)];

  const files = new Set<string>();

  for (const base of ['origin/main', 'main']) {
    const rev = await $`git rev-parse --verify ${base}`.nothrow().quiet();
    if (rev.exitCode === 0) {
      const diff = await $`git diff --name-only ${base}...HEAD`.text();
      for (const file of diff.split('\n')) files.add(file.trim());
      break;
    }
  }

  const workingTree = await $`git diff --name-only`.text();
  for (const file of workingTree.split('\n')) files.add(file.trim());

  const untracked = await $`git ls-files --others --exclude-standard`.text();
  for (const file of untracked.split('\n')) files.add(file.trim());

  return [...files].filter(Boolean);
}

function collect(changed: string[]): {
  guards: string[];
  tests: string[];
  regens: string[];
} {
  const guards = new Set<string>();
  const tests = new Set<string>();
  const regens = new Set<string>();

  let codeChanged = false;
  let testsChanged = false;

  for (const file of changed) {
    if (file.startsWith('src/') || file.startsWith('scripts/')) {
      codeChanged = true;
    }
    if (file.startsWith('tests/')) testsChanged = true;

    for (const rule of RULES) {
      if (rule.match.some((m) => file === m || file.startsWith(m))) {
        rule.guards?.forEach((g) => guards.add(g));
        rule.tests?.forEach((t) => tests.add(t));
        rule.regens?.forEach((r) => regens.add(r));
      }
    }
  }

  if (codeChanged) {
    guards.add('check:quick');
  }
  if (testsChanged) {
    tests.add('test:changed');
  }

  return { guards: [...guards], tests: [...tests], regens: [...regens] };
}

async function main() {
  const argv = process.argv.slice(2);
  const explicit = argv.filter((arg) => !arg.startsWith('--'));

  const changed = await getChangedFiles(explicit);
  const { guards, tests, regens } = collect(changed);

  console.log(`Changed ${changed.length} file(s).`);
  if (guards.length > 0) console.log(`Guards: ${guards.join(', ')}`);
  if (tests.length > 0) console.log(`Tests: ${tests.join(', ')}`);
  if (regens.length > 0) console.log(`Regenerate: ${regens.join(', ')}`);
  console.log('');

  const steps = [
    ...guards.map((g) => ({ label: g, cmd: ['bun', 'run', g] })),
    ...tests.map((t) => ({ label: t, cmd: ['bun', 'run', t] })),
  ];

  if (steps.length === 0) {
    console.log('✅ no applicable guards or tests for these changes');
    process.exit(0);
  }

  for (const step of steps) {
    const start = performance.now();
    const result = await $`${step.cmd}`.nothrow().quiet();
    const ms = Math.round(performance.now() - start);
    if (result.exitCode === 0) {
      console.log(`✔ ${step.label} (${ms}ms)`);
    } else {
      console.error(`✖ ${step.label} failed after ${ms}ms`);
      const stderr = result.stderr.toString().trim();
      if (stderr) console.error(stderr);
      console.error(`Re-run verbosely: ${step.cmd.join(' ')}`);
      process.exit(result.exitCode);
    }
  }

  console.log('✅ all applicable checks passed');
  if (regens.length > 0) {
    console.log(`▶ run after: ${regens.join(', ')}`);
  }
}

await main();
