#!/usr/bin/env node
/**
 * Command-line view of the corpus, for implementers who are porting it.
 *
 *   eel-conformance sections            sections, case counts, provisional counts
 *   eel-conformance cases [section]     every case id and the rule it pins
 *   eel-conformance show <section/id>   one case as JSON
 *   eel-conformance validate            loader invariants and shape checks
 *   eel-conformance where               print the cases directory
 *
 * Running the corpus against an engine is not done here: that needs the
 * engine. See `runConformance` in the README for the three-line harness.
 */
import {
  EEL_CONFORMANCE_CASES_DIR,
  type EelConformanceCase,
  loadEelCaseGroups,
  qualifiedId,
} from './index.ts';

const CASE_KEYS = new Set([
  'id',
  'name',
  'program',
  'env',
  'megabuf',
  'gmegabuf',
  'expected',
  'expectedMegabuf',
  'expectedGmegabuf',
  'note',
  'status',
  'section',
]);
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VAR_PATTERN = /^[a-z_][a-z0-9_]*$/;
const SLOT_PATTERN = /^-?[0-9]+$/;

/**
 * Shape checks mirroring schema.json, so `validate` works without a JSON
 * Schema library. The schema remains the normative statement; this is the
 * dependency-free echo of it.
 */
export function validateCaseShape(specCase: EelConformanceCase): string[] {
  const problems: string[] = [];
  const id = qualifiedId(specCase);
  for (const key of Object.keys(specCase)) {
    if (!CASE_KEYS.has(key)) problems.push(`${id}: unknown key "${key}"`);
  }
  if (!ID_PATTERN.test(specCase.id)) {
    problems.push(`${id}: id is not kebab-case`);
  }
  if (typeof specCase.name !== 'string' || specCase.name.length === 0) {
    problems.push(`${id}: name is missing`);
  }
  if (!Array.isArray(specCase.program) || specCase.program.length === 0) {
    problems.push(`${id}: program is empty`);
  }
  for (const field of ['env', 'expected'] as const) {
    for (const key of Object.keys(specCase[field] ?? {})) {
      if (!VAR_PATTERN.test(key)) {
        problems.push(`${id}: ${field} key "${key}" is not a lower-case name`);
      }
    }
  }
  for (const field of [
    'megabuf',
    'gmegabuf',
    'expectedMegabuf',
    'expectedGmegabuf',
  ] as const) {
    for (const key of Object.keys(specCase[field] ?? {})) {
      if (!SLOT_PATTERN.test(key)) {
        problems.push(`${id}: ${field} slot "${key}" is not an integer`);
      }
    }
  }
  if (
    specCase.status !== undefined &&
    specCase.status !== 'pinned' &&
    specCase.status !== 'provisional'
  ) {
    problems.push(
      `${id}: status "${specCase.status}" is not pinned|provisional`,
    );
  }
  return problems;
}

function pad(value: string | number, width: number) {
  return String(value).padEnd(width);
}

export function main(argv: string[]): number {
  const [command = 'sections', argument] = argv;
  const groups = loadEelCaseGroups();

  switch (command) {
    case 'where': {
      console.log(EEL_CONFORMANCE_CASES_DIR);
      return 0;
    }
    case 'sections': {
      const width = Math.max(...groups.map((g) => g.section.length)) + 2;
      console.log(`${pad('section', width)}cases  provisional  description`);
      let total = 0;
      let provisional = 0;
      for (const group of groups) {
        const p = group.cases.filter((c) => c.status === 'provisional').length;
        total += group.cases.length;
        provisional += p;
        console.log(
          `${pad(group.section, width)}${pad(group.cases.length, 7)}${pad(p || '-', 13)}${group.description}`,
        );
      }
      console.log(
        `\n${total} cases in ${groups.length} sections, ${provisional} provisional`,
      );
      return 0;
    }
    case 'cases': {
      const selected = argument
        ? groups.filter((g) => g.section === argument)
        : groups;
      if (selected.length === 0) {
        console.error(`Unknown section "${argument}".`);
        return 2;
      }
      for (const group of selected) {
        console.log(`${group.section}`);
        for (const c of group.cases) {
          const tag = c.status === 'provisional' ? '  [provisional]' : '';
          console.log(`  ${c.id}${tag}`);
          console.log(`      ${c.name}`);
        }
      }
      return 0;
    }
    case 'show': {
      if (!argument) {
        console.error('Usage: eel-conformance show <section/id>');
        return 2;
      }
      const found = groups
        .flatMap((g) => g.cases)
        .find((c) => qualifiedId(c) === argument);
      if (!found) {
        console.error(`No case named "${argument}".`);
        return 2;
      }
      console.log(JSON.stringify(found, null, 2));
      return 0;
    }
    case 'validate': {
      const problems = groups.flatMap((g) =>
        g.cases.flatMap(validateCaseShape),
      );
      if (problems.length > 0) {
        for (const problem of problems) console.error(problem);
        return 1;
      }
      const count = groups.reduce((n, g) => n + g.cases.length, 0);
      console.log(`${count} cases in ${groups.length} sections: shape ok.`);
      return 0;
    }
    default: {
      console.error(
        'Usage: eel-conformance <sections|cases [section]|show <section/id>|validate|where>',
      );
      return 2;
    }
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
