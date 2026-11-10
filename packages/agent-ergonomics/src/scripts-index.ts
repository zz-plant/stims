/**
 * The script index behind `help`: every runner script grouped by namespace,
 * each with a one-line purpose read from the docblock atop its target file,
 * plus the symptom-to-instrument routing of `help --for`.
 *
 * The purpose lines are generated, never written, so the index cannot drift
 * from the code: `help --check` fails when a script's target file has no
 * docblock summary, which turns "add a docblock" into a gate rather than a
 * convention.
 *
 * `--for "<symptom>"` answers the question the plain listing cannot: not
 * "what scripts exist" but "which one answers what I am actually asking".
 * Curated routes come first because the best answer is often a script whose
 * name shares no words with the symptom; keyword matching over the generated
 * index is the fallback.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentErgonomicsConfig } from './config.ts';
import type { Command, Io } from './context.ts';
import { parseDocblock } from './docblock.ts';

export type ScriptEntry = { name: string; command: string };

export type ScriptIndex = {
  /** Scripts whose name has no namespace prefix. */
  bare: ScriptEntry[];
  /** Scripts grouped by the prefix before the first colon, in package.json order. */
  groups: Map<string, ScriptEntry[]>;
  count: number;
  /** Every entry, bare first then grouped, in package.json order. */
  all: ScriptEntry[];
  /** The target file a command runs, relative to the scripts directory. */
  targetFile: (command: string) => string | null;
  /** The docblock purpose of a command's target file, or null. */
  purpose: (command: string) => string | null;
  /** The purpose, with the distinguishing flags appended when several names share a file. */
  summarize: (command: string) => string | null;
};

export type ScriptIndexOptions = {
  root: string;
  scripts: Record<string, string>;
  scriptsDir: string;
  docblockWindow: number;
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function buildScriptIndex({
  root,
  scripts,
  scriptsDir,
  docblockWindow,
}: ScriptIndexOptions): ScriptIndex {
  const targetPattern = new RegExp(
    `${escapeRegExp(scriptsDir)}\\/([^\\s/]+\\.(?:ts|mjs|js))`,
    'u',
  );
  const targetFile = (command: string) =>
    command.match(targetPattern)?.[1] ?? null;

  const purposes = new Map<string, string | null>();
  const purpose = (command: string): string | null => {
    const file = targetFile(command);
    if (!file) return null;
    const cached = purposes.get(file);
    if (cached !== undefined) return cached;
    const value = filePurpose(file);
    purposes.set(file, value);
    return value;
  };

  function filePurpose(file: string): string | null {
    let text: string;
    try {
      text = readFileSync(join(root, scriptsDir, file), 'utf8');
    } catch {
      return null;
    }
    const block = parseDocblock(text, { openerWithin: docblockWindow });
    if (!block) return null;

    // Drop a leading `some-script[.ts] — ` restatement; the name is already
    // the first column of the row.
    const base = file.replace(/\.(?:ts|mjs|js)$/u, '');
    const selfRef = new RegExp(
      `^${escapeRegExp(base)}(?:\\.(?:ts|mjs|js))?\\s*[—–-]\\s*`,
      'u',
    );
    const summary = block.summary
      .replace(selfRef, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/^\p{Ll}/u, (c) => c.toUpperCase());
    if (summary.length <= 3) return null;

    // First sentence only — keep the padded column scannable.
    const sentence = /^(.+?[.!?])(?:\s|$)/u.exec(summary);
    return sentence ? (sentence[1] ?? summary) : summary;
  }

  const bare: ScriptEntry[] = [];
  const groups = new Map<string, ScriptEntry[]>();
  for (const [name, command] of Object.entries(scripts)) {
    const entry = { name, command };
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
  const all = [...bare, ...[...groups.values()].flat()];

  // Several names point at one script and differ only by flags. They'd
  // otherwise render as identical rows, so the flags — the only thing that
  // distinguishes them — get appended.
  const fileUsage = new Map<string, number>();
  for (const { command } of all) {
    const file = targetFile(command);
    if (file) fileUsage.set(file, (fileUsage.get(file) ?? 0) + 1);
  }

  const summarize = (command: string): string | null => {
    const text = purpose(command);
    if (!text) return null;
    const file = targetFile(command);
    if (!file || (fileUsage.get(file) ?? 0) < 2) return text;
    const args = command.slice(command.indexOf(file) + file.length).trim();
    if (!args) return text;
    const shown = args.length > 48 ? `${args.slice(0, 47).trimEnd()}…` : args;
    return `${text} [${shown}]`;
  };

  return {
    bare,
    groups,
    count: all.length,
    all,
    targetFile,
    purpose,
    summarize,
  };
}

export type IndexRecord = {
  name: string;
  command: string;
  purpose: string | null;
};

/** The `--json` shape: `{ bare, groups: { [prefix]: { note, scripts } } }`. */
export function indexToJson(
  index: ScriptIndex,
  prefixNotes: Record<string, string>,
): {
  bare: IndexRecord[];
  groups: Record<string, { note: string | null; scripts: IndexRecord[] }>;
} {
  const describe = ({ name, command }: ScriptEntry): IndexRecord => ({
    name,
    command,
    purpose: index.summarize(command),
  });
  return {
    bare: index.bare.map(describe),
    groups: Object.fromEntries(
      [...index.groups].map(([prefix, entries]) => [
        prefix,
        { note: prefixNotes[prefix] ?? null, scripts: entries.map(describe) },
      ]),
    ),
  };
}

/** The plain listing, grouped, with purposes in a padded column. */
export function renderListing(
  index: ScriptIndex,
  {
    title,
    prefixNotes,
    runner,
  }: { title: string; prefixNotes: Record<string, string>; runner: string },
): string[] {
  const pad = (list: ScriptEntry[]) => {
    const width = Math.max(...list.map(({ name }) => name.length));
    return list.map(({ name, command }) => {
      const text = index.summarize(command);
      return `  ${name.padEnd(width)}  ${text ?? command}`;
    });
  };
  const lines = [
    `${title} (${index.count}) — run any with \`${runner} <name>\`.`,
  ];
  if (index.bare.length > 0) lines.push('\nTop-level:', ...pad(index.bare));
  for (const [prefix, entries] of [...index.groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(
      `\n${prefix}: — ${prefixNotes[prefix] ?? prefix}`,
      ...pad(entries),
    );
  }
  return lines;
}

/**
 * The index narrowed to scripts whose name contains any of the terms, so
 * `help parity lab:` lists two namespaces instead of every script. Matching is
 * on the name only; `--for` is the search over what a script does.
 */
export function filterIndex(index: ScriptIndex, terms: string[]): ScriptIndex {
  const wanted = terms.map((term) => term.toLowerCase());
  const keep = ({ name }: ScriptEntry) => {
    const lowered = name.toLowerCase();
    return wanted.some((term) => lowered.includes(term));
  };
  const bare = index.bare.filter(keep);
  const groups = new Map<string, ScriptEntry[]>();
  for (const [prefix, entries] of index.groups) {
    const kept = entries.filter(keep);
    if (kept.length > 0) groups.set(prefix, kept);
  }
  const all = [...bare, ...[...groups.values()].flat()];
  return { ...index, bare, groups, all, count: all.length };
}

/** Script names whose target file has no docblock summary. */
export function undocumentedScripts(
  index: ScriptIndex,
  scriptsDir: string,
): string[] {
  const targeted = new RegExp(
    `${escapeRegExp(scriptsDir)}\\/[^\\s/]+\\.(?:ts|mjs|js)`,
    'u',
  );
  return index.all
    .filter(({ command }) => targeted.test(command))
    .filter(({ command }) => index.purpose(command) === null)
    .map(({ name }) => name);
}

export type RouteMatch =
  | { kind: 'routes'; routes: AgentErgonomicsConfig['help']['routes'] }
  | {
      kind: 'keywords';
      matches: Array<{ name: string; purpose: string | null }>;
    }
  | { kind: 'none' };

/**
 * Scores the curated routes against a symptom: an exact phrase is worth ten
 * of a loose word match, so "preset looks wrong" beats a route that merely
 * shares the word "preset". Falls back to the generated index when no route
 * matches at all.
 */
export function routeSymptom(
  query: string,
  index: ScriptIndex,
  routes: AgentErgonomicsConfig['help']['routes'],
): RouteMatch {
  const lowered = query.toLowerCase().trim();
  const scored = routes
    .map((route) => {
      const hits = route.when.filter((term) => lowered.includes(term)).length;
      const loose = route.when.filter((term) =>
        term
          .split(' ')
          .some((word) => word.length > 3 && lowered.includes(word)),
      ).length;
      return { route, score: hits * 10 + loose };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    return { kind: 'routes', routes: scored.slice(0, 3).map((s) => s.route) };
  }

  const words = lowered.split(/\s+/u).filter((word) => word.length > 3);
  const matches = index.all
    .map(({ name, command }) => ({ name, purpose: index.summarize(command) }))
    .filter(({ name, purpose }) => {
      const haystack = `${name} ${purpose ?? ''}`.toLowerCase();
      return words.some((word) => haystack.includes(word));
    })
    .slice(0, 8);
  return matches.length === 0
    ? { kind: 'none' }
    : { kind: 'keywords', matches };
}

function printRoute(
  query: string,
  match: RouteMatch,
  index: ScriptIndex,
  scripts: Record<string, string>,
  config: AgentErgonomicsConfig,
  io: Io,
) {
  const { runner } = config;
  if (match.kind === 'routes') {
    io.log(`\nFor "${query}":\n`);
    for (const route of match.routes) {
      for (const name of route.run) {
        const command = scripts[name];
        const text = command ? index.summarize(command) : null;
        io.log(`  ${runner} ${name}`);
        if (text) io.log(`      ${text}`);
      }
      io.log(`      ↳ ${route.note}\n`);
    }
    return;
  }
  if (match.kind === 'none') {
    const pointers = config.help.noMatchPointers;
    const width = Math.max(0, ...pointers.map((p) => p.name.length));
    io.log(
      `\nNo route for "${query}".\n\n${pointers
        .map((p) => `  ${p.name.padEnd(width)}  ${p.text}\n`)
        .join('')}`,
    );
    return;
  }
  io.log(`\nNo curated route for "${query}". Closest by keyword:\n`);
  for (const { name, purpose } of match.matches) {
    io.log(`  ${runner} ${name}`);
    if (purpose) io.log(`      ${purpose}`);
  }
  io.log();
}

export function readPackageScripts(root: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

/** `help [<name-part>…] [--json] | --check | --for <symptom…>` */
export const runHelp: Command = (args, { config, cwd, io }) => {
  const scripts = readPackageScripts(cwd);
  const index = buildScriptIndex({
    root: cwd,
    scripts,
    scriptsDir: config.scriptsDir,
    docblockWindow: config.help.docblockWindow,
  });

  const forIndex = args.indexOf('--for');
  if (forIndex !== -1) {
    const query = args
      .slice(forIndex + 1)
      .join(' ')
      .toLowerCase()
      .trim();
    if (!query) {
      io.error(`Usage: ${config.commands.help} --for "my preset looks wrong"`);
      return 1;
    }
    printRoute(
      query,
      routeSymptom(query, index, config.help.routes),
      index,
      scripts,
      config,
      io,
    );
    return 0;
  }

  if (args.includes('--check')) {
    // A script whose target file has no docblock shows its raw shell command
    // in the listing, which is exactly the discoverability gap this index
    // exists to close. Fail so the gap is fixed at the source rather than
    // accumulating.
    const undocumented = undocumentedScripts(index, config.scriptsDir);
    if (undocumented.length > 0) {
      io.error(
        `${undocumented.length} script(s) have no docblock summary, so \`${config.commands.help}\` shows their raw command:\n`,
      );
      for (const name of undocumented) io.error(`  ${name}`);
      io.error(
        `\nAdd a \`/** … */\` block atop the target file in ${config.scriptsDir}/. The first paragraph becomes the summary.`,
      );
      return 1;
    }
    io.log(`All ${index.count} scripts resolve to a docblock summary.`);
    return 0;
  }

  // Bare words narrow the listing by name. Without this the only way to see
  // one namespace was to pipe `--json` into a one-off script, and guessing
  // that payload's shape wrong was the most common way `help` failed.
  const terms = args.filter((arg) => !arg.startsWith('-'));
  const shown = terms.length > 0 ? filterIndex(index, terms) : index;
  if (shown.count === 0) {
    io.error(
      `No script name contains ${terms.map((term) => JSON.stringify(term)).join(' or ')}. Search by what a script does with \`${config.commands.help} --for "<symptom>"\`.`,
    );
    return 1;
  }

  if (args.includes('--json')) {
    io.log(
      JSON.stringify(indexToJson(shown, config.help.prefixNotes), null, 2),
    );
    return 0;
  }

  for (const line of renderListing(shown, {
    title:
      terms.length > 0
        ? `${config.help.title} matching ${terms.map((term) => JSON.stringify(term)).join(' or ')}`
        : config.help.title,
    prefixNotes: config.help.prefixNotes,
    runner: config.runner,
  })) {
    io.log(line);
  }
  return 0;
};
