/**
 * The config file that drives every subcommand: its shape, its defaults, the
 * validation that rejects a wrong one with the path of each problem, and the
 * loader that finds and imports it.
 *
 * Everything repo-specific lives here and nowhere else: the symptom routes
 * and prefix notes behind `help`, the step lists behind `gate`, the doc roots
 * and allowlists behind the guards, the git defaults behind the branch
 * helpers. The subcommands are the mechanism; this file is the policy. A
 * config is a TypeScript or JavaScript module whose default export is the
 * object (`defineConfig` only types it), or a JSON file when no pattern needs
 * flags beyond what a string can carry.
 *
 * Validation is strict about one thing on purpose: every allowlist entry and
 * backlog entry is a path with a reason or a path that exists, never a bare
 * exemption. An allowlist that accepts entries without a reason stops being a
 * record of deliberate exceptions and becomes the place rules go to die.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type GateMode = 'quick' | 'full' | 'all';
export const GATE_MODES: readonly GateMode[] = ['quick', 'full', 'all'];

/** One step of the quality gate. */
export type GateStep = {
  label: string;
  cmd: string[];
  /** The modes the step runs in; every mode when omitted. */
  modes?: GateMode[];
  /** A different command when an environment variable has a given value. */
  envCmd?: { name: string; value: string; cmd: string[] };
};

/** A symptom-to-instrument route for `help --for`. */
export type Route = {
  /** Phrases, in the words someone would actually use. */
  when: string[];
  /** Script names to run, in order. */
  run: string[];
  /** Why these, and which to reach for first. */
  note: string;
};

/** A regular expression, or its source as a string for JSON configs. */
export type Pattern = RegExp | string;

/** The input shape: every section and field optional, patterns as strings or RegExps. */
export type AgentErgonomicsConfigInput = {
  /** Directory the runner's scripts live in, relative to the root. */
  scriptsDir?: string;
  /** How a script is invoked in this repo, e.g. `bun run`. */
  runner?: string;
  /** How each subcommand is reached in this repo, for usage messages. */
  commands?: Partial<AgentErgonomicsConfig['commands']>;
  help?: Partial<{
    title: string;
    prefixNotes: Record<string, string>;
    routes: Route[];
    noMatchPointers: Array<{ name: string; text: string }>;
    docblockWindow: number;
  }>;
  gate?: Partial<{
    quietEnv: string;
    agentEnvs: string[];
    summaryLabel: string;
    preflight: GateStep[];
    concurrent: GateStep[];
    postflight: Partial<Record<GateMode, GateStep[]>>;
  }>;
  guardrails?: Partial<{
    output: string;
    guardPrefix: string;
    exclude: string[];
    gateCommands: { quick: string; full: string };
    title: string;
    intro: string[];
    docblockWindow: number;
  }>;
  docRefs?: Partial<{
    roots: string[];
    extraFiles: string[];
    generatedDocs: string[];
    skipDirs: string[];
    historicalRecord: Pattern;
    placeholder: Pattern;
    historicalPath: Pattern;
    proposalLine: Pattern;
    pathPrefixes: string[];
  }>;
  moduleDocs?: Partial<{
    include: string;
    minLines: number;
    minSummaryLength: number;
    backlog: string[];
    seeAlso: string;
    docblockWindow: number;
  }>;
  testSourceGreps?: Partial<{
    testsDir: string;
    sourceDirs: string[];
    allowed: Record<string, string>;
    debtPrefix: string;
  }>;
  git?: Partial<{
    remote: string;
    defaultBase: string;
    worktreesDir: string;
    install: string[];
  }>;
  prBody?: Partial<{
    templatePath: string;
    checklistHeading: Pattern;
    docPath: Pattern;
    testPath: Pattern;
    defaultBase: string;
    ciRuleSource: string;
  }>;
  commitMsg?: Partial<{
    subjectLengthLimit: number;
    types: string[];
    badSubjects: Pattern;
    hopeful: Pattern;
    gitGenerated: Pattern;
    badSubjectHint: string;
    example: string;
  }>;
};

/** The resolved shape every subcommand reads: defaults applied, patterns compiled. */
export type AgentErgonomicsConfig = {
  scriptsDir: string;
  runner: string;
  commands: {
    help: string;
    gate: string;
    gateQuick: string;
    generateGuardrails: string;
    branchRestart: string;
    worktreeNew: string;
    prBody: string;
  };
  help: {
    title: string;
    prefixNotes: Record<string, string>;
    routes: Route[];
    noMatchPointers: Array<{ name: string; text: string }>;
    docblockWindow: number;
  };
  gate: {
    quietEnv: string;
    agentEnvs: string[];
    summaryLabel: string;
    preflight: GateStep[];
    concurrent: GateStep[];
    postflight: Partial<Record<GateMode, GateStep[]>>;
  };
  guardrails: {
    output: string;
    guardPrefix: string;
    exclude: string[];
    gateCommands: { quick: string; full: string };
    title: string;
    intro: string[];
    docblockWindow: number;
  };
  docRefs: {
    roots: string[];
    extraFiles: string[];
    generatedDocs: string[];
    skipDirs: string[];
    historicalRecord: RegExp;
    placeholder: RegExp;
    historicalPath: RegExp;
    proposalLine: RegExp;
    pathPrefixes: string[];
  };
  moduleDocs: {
    include: string;
    minLines: number;
    minSummaryLength: number;
    backlog: string[];
    seeAlso: string;
    docblockWindow: number;
  };
  testSourceGreps: {
    testsDir: string;
    sourceDirs: string[];
    allowed: Record<string, string>;
    debtPrefix: string;
  };
  git: {
    remote: string;
    defaultBase: string;
    worktreesDir: string;
    install: string[];
  };
  prBody: {
    templatePath: string;
    checklistHeading: RegExp;
    docPath: RegExp;
    testPath: RegExp;
    defaultBase: string;
    ciRuleSource: string;
  };
  commitMsg: {
    subjectLengthLimit: number;
    types: string[];
    badSubjects: RegExp;
    hopeful: RegExp;
    gitGenerated: RegExp;
    badSubjectHint: string;
    example: string;
  };
};

export const DEFAULT_CONFIG: AgentErgonomicsConfig = {
  scriptsDir: 'scripts',
  runner: 'bun run',
  commands: {
    help: 'agent-ergonomics help',
    gate: 'agent-ergonomics gate',
    gateQuick: 'agent-ergonomics gate --quick',
    generateGuardrails: 'agent-ergonomics guardrails',
    branchRestart: 'agent-ergonomics branch-restart',
    worktreeNew: 'agent-ergonomics worktree-new',
    prBody: 'agent-ergonomics pr-body',
  },
  help: {
    title: 'Scripts',
    prefixNotes: {},
    routes: [],
    noMatchPointers: [],
    docblockWindow: 30,
  },
  gate: {
    quietEnv: 'AGENT_ERGONOMICS_QUIET',
    agentEnvs: ['CLAUDECODE'],
    summaryLabel: 'Quality gate',
    preflight: [],
    concurrent: [],
    postflight: {},
  },
  guardrails: {
    output: 'docs/GUARDRAILS.md',
    guardPrefix: 'check:',
    exclude: [],
    gateCommands: { quick: 'check:quick', full: 'check' },
    title: 'What this repo enforces',
    intro: [],
    docblockWindow: 10,
  },
  docRefs: {
    roots: ['docs'],
    extraFiles: ['README.md'],
    generatedDocs: [],
    skipDirs: ['node_modules', '.git', 'dist'],
    historicalRecord: /(?!)/u,
    placeholder: /path\/to|your-file|YYYY-MM|<[a-z-]+>/u,
    historicalPath: /\b[0-9a-f]{7,40}:$/u,
    proposalLine: /(?!)/u,
    pathPrefixes: ['src', 'tests', 'scripts', 'docs'],
  },
  moduleDocs: {
    include: 'src/**/*.{ts,tsx}',
    minLines: 400,
    minSummaryLength: 40,
    backlog: [],
    seeAlso: '',
    docblockWindow: 10,
  },
  testSourceGreps: {
    testsDir: 'tests',
    sourceDirs: ['src', 'scripts'],
    allowed: {},
    debtPrefix: 'DEBT:',
  },
  git: {
    remote: 'origin',
    defaultBase: 'main',
    worktreesDir: 'worktrees',
    install: ['bun', 'install'],
  },
  prBody: {
    templatePath: '.github/pull_request_template.md',
    checklistHeading: /^## Review risk checklist/mu,
    docPath: /^(docs\/|README\.md$|CONTRIBUTING\.md$|AGENTS\.md$)/u,
    testPath: /^tests\/.*\.test\.(?:ts|tsx|js|jsx)$/u,
    defaultBase: 'origin/main',
    ciRuleSource: '',
  },
  commitMsg: {
    subjectLengthLimit: 72,
    types: [
      'feat',
      'fix',
      'refactor',
      'chore',
      'docs',
      'test',
      'style',
      'perf',
      'ci',
      'build',
      'revert',
      'hotfix',
    ],
    badSubjects:
      /^(fixes|fixed|various fixes|certainly this works|hopefully works|hopefully|it works|works now|wip)$/iu,
    hopeful: /\b(certainly|hopefully)\b/iu,
    gitGenerated:
      /^(Merge (branch|remote-tracking branch|commit|tag) .+|Revert ".+"( \(#\d+\))?)$/u,
    badSubjectHint: 'Describe what changed and why.',
    example: 'fix(audio): close context on unmount',
  },
};

/** Names a config file that is wrong, with every problem and its path. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[], source?: string) {
    super(
      `${source ? `${source}: ` : ''}invalid agent-ergonomics config:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Types the config object; it changes nothing. */
export function defineConfig(
  config: AgentErgonomicsConfigInput,
): AgentErgonomicsConfigInput {
  return config;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function toPattern(value: unknown, path: string, problems: string[]): RegExp {
  if (value instanceof RegExp) return value;
  if (typeof value === 'string') {
    try {
      return new RegExp(value, 'u');
    } catch (error) {
      problems.push(`${path}: not a valid regular expression (${error})`);
    }
  } else {
    problems.push(`${path}: expected a RegExp or a pattern string`);
  }
  return /(?!)/u;
}

type SectionName = Exclude<
  keyof AgentErgonomicsConfig,
  'scriptsDir' | 'runner'
>;

/**
 * Applies the defaults to a config and validates the result. Returns the
 * resolved config or throws a `ConfigError` naming every problem at once, so
 * a wrong file is fixed in one pass rather than one field per run.
 */
export function resolveConfig(
  input: unknown,
  source?: string,
): AgentErgonomicsConfig {
  const problems: string[] = [];
  if (!isRecord(input)) {
    throw new ConfigError(
      ['the config must be an object (the module’s default export)'],
      source,
    );
  }

  const known = new Set<string>([
    'scriptsDir',
    'runner',
    'commands',
    'help',
    'gate',
    'guardrails',
    'docRefs',
    'moduleDocs',
    'testSourceGreps',
    'git',
    'prBody',
    'commitMsg',
  ]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) problems.push(`${key}: unknown section`);
  }

  const section = <N extends SectionName>(
    name: N,
  ): AgentErgonomicsConfig[N] => {
    const given = input[name];
    if (given === undefined) return { ...DEFAULT_CONFIG[name] };
    if (!isRecord(given)) {
      problems.push(`${name}: expected an object`);
      return { ...DEFAULT_CONFIG[name] };
    }
    const defaults = DEFAULT_CONFIG[name] as Record<string, unknown>;
    for (const key of Object.keys(given)) {
      if (!(key in defaults)) problems.push(`${name}.${key}: unknown field`);
    }
    return { ...defaults, ...given } as AgentErgonomicsConfig[N];
  };

  const expectString = (value: unknown, path: string) => {
    if (typeof value !== 'string' || value.length === 0) {
      problems.push(`${path}: expected a non-empty string`);
    }
  };
  const expectStrings = (value: unknown, path: string) => {
    if (!isStringArray(value)) problems.push(`${path}: expected string[]`);
  };
  const expectNumber = (value: unknown, path: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      problems.push(`${path}: expected a positive number`);
    }
  };
  const expectReasons = (value: unknown, path: string) => {
    if (!isRecord(value)) {
      problems.push(`${path}: expected { path: reason }`);
      return;
    }
    for (const [key, reason] of Object.entries(value)) {
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        problems.push(
          `${path}.${key}: an allowlist entry needs a reason, not a bare exemption`,
        );
      }
    }
  };
  const expectSteps = (value: unknown, path: string): GateStep[] => {
    if (!Array.isArray(value)) {
      problems.push(`${path}: expected GateStep[]`);
      return [];
    }
    value.forEach((step, index) => {
      const at = `${path}[${index}]`;
      if (!isRecord(step)) {
        problems.push(`${at}: expected { label, cmd }`);
        return;
      }
      expectString(step.label, `${at}.label`);
      if (!isStringArray(step.cmd) || step.cmd.length === 0) {
        problems.push(`${at}.cmd: expected a non-empty string[]`);
      }
      if (step.modes !== undefined) {
        if (
          !isStringArray(step.modes) ||
          step.modes.some((mode) => !GATE_MODES.includes(mode as GateMode))
        ) {
          problems.push(
            `${at}.modes: expected a subset of ${GATE_MODES.join(', ')}`,
          );
        }
      }
      if (step.envCmd !== undefined) {
        const envCmd = step.envCmd;
        if (
          !isRecord(envCmd) ||
          typeof envCmd.name !== 'string' ||
          typeof envCmd.value !== 'string' ||
          !isStringArray(envCmd.cmd)
        ) {
          problems.push(`${at}.envCmd: expected { name, value, cmd }`);
        }
      }
    });
    return value as GateStep[];
  };

  const scriptsDir =
    typeof input.scriptsDir === 'string'
      ? input.scriptsDir
      : DEFAULT_CONFIG.scriptsDir;
  if (input.scriptsDir !== undefined)
    expectString(input.scriptsDir, 'scriptsDir');
  const runner =
    typeof input.runner === 'string' ? input.runner : DEFAULT_CONFIG.runner;
  if (input.runner !== undefined) expectString(input.runner, 'runner');

  const commands = section('commands');
  for (const [key, value] of Object.entries(commands)) {
    expectString(value, `commands.${key}`);
  }

  const help = section('help');
  expectString(help.title, 'help.title');
  if (!isRecord(help.prefixNotes)) {
    problems.push('help.prefixNotes: expected { prefix: note }');
  }
  expectNumber(help.docblockWindow, 'help.docblockWindow');
  if (!Array.isArray(help.routes)) {
    problems.push('help.routes: expected Route[]');
  } else {
    help.routes.forEach((route, index) => {
      const at = `help.routes[${index}]`;
      if (!isRecord(route)) {
        problems.push(`${at}: expected { when, run, note }`);
        return;
      }
      if (!isStringArray(route.when) || route.when.length === 0) {
        problems.push(`${at}.when: expected a non-empty string[]`);
      }
      if (!isStringArray(route.run) || route.run.length === 0) {
        problems.push(`${at}.run: expected a non-empty string[]`);
      }
      expectString(route.note, `${at}.note`);
    });
  }
  if (!Array.isArray(help.noMatchPointers)) {
    problems.push('help.noMatchPointers: expected { name, text }[]');
  } else {
    help.noMatchPointers.forEach((pointer, index) => {
      if (
        !isRecord(pointer) ||
        typeof pointer.name !== 'string' ||
        typeof pointer.text !== 'string'
      ) {
        problems.push(
          `help.noMatchPointers[${index}]: expected { name, text }`,
        );
      }
    });
  }

  const gate = section('gate');
  expectString(gate.quietEnv, 'gate.quietEnv');
  expectStrings(gate.agentEnvs, 'gate.agentEnvs');
  expectString(gate.summaryLabel, 'gate.summaryLabel');
  gate.preflight = expectSteps(gate.preflight, 'gate.preflight');
  gate.concurrent = expectSteps(gate.concurrent, 'gate.concurrent');
  if (!isRecord(gate.postflight)) {
    problems.push('gate.postflight: expected { [mode]: GateStep[] }');
    gate.postflight = {};
  } else {
    for (const [mode, steps] of Object.entries(gate.postflight)) {
      if (!GATE_MODES.includes(mode as GateMode)) {
        problems.push(`gate.postflight.${mode}: not a gate mode`);
        continue;
      }
      expectSteps(steps, `gate.postflight.${mode}`);
    }
  }

  const guardrails = section('guardrails');
  expectString(guardrails.output, 'guardrails.output');
  expectString(guardrails.guardPrefix, 'guardrails.guardPrefix');
  expectStrings(guardrails.exclude, 'guardrails.exclude');
  expectString(guardrails.title, 'guardrails.title');
  expectStrings(guardrails.intro, 'guardrails.intro');
  expectNumber(guardrails.docblockWindow, 'guardrails.docblockWindow');
  if (
    !isRecord(guardrails.gateCommands) ||
    typeof guardrails.gateCommands.quick !== 'string' ||
    typeof guardrails.gateCommands.full !== 'string'
  ) {
    problems.push('guardrails.gateCommands: expected { quick, full }');
  }

  const docRefsIn = section('docRefs') as unknown as Record<string, unknown>;
  expectStrings(docRefsIn.roots, 'docRefs.roots');
  expectStrings(docRefsIn.extraFiles, 'docRefs.extraFiles');
  expectStrings(docRefsIn.generatedDocs, 'docRefs.generatedDocs');
  expectStrings(docRefsIn.skipDirs, 'docRefs.skipDirs');
  expectStrings(docRefsIn.pathPrefixes, 'docRefs.pathPrefixes');
  const docRefs: AgentErgonomicsConfig['docRefs'] = {
    roots: docRefsIn.roots as string[],
    extraFiles: docRefsIn.extraFiles as string[],
    generatedDocs: docRefsIn.generatedDocs as string[],
    skipDirs: docRefsIn.skipDirs as string[],
    pathPrefixes: docRefsIn.pathPrefixes as string[],
    historicalRecord: toPattern(
      docRefsIn.historicalRecord,
      'docRefs.historicalRecord',
      problems,
    ),
    placeholder: toPattern(
      docRefsIn.placeholder,
      'docRefs.placeholder',
      problems,
    ),
    historicalPath: toPattern(
      docRefsIn.historicalPath,
      'docRefs.historicalPath',
      problems,
    ),
    proposalLine: toPattern(
      docRefsIn.proposalLine,
      'docRefs.proposalLine',
      problems,
    ),
  };

  const moduleDocs = section('moduleDocs');
  expectString(moduleDocs.include, 'moduleDocs.include');
  expectNumber(moduleDocs.minLines, 'moduleDocs.minLines');
  expectNumber(moduleDocs.minSummaryLength, 'moduleDocs.minSummaryLength');
  expectStrings(moduleDocs.backlog, 'moduleDocs.backlog');
  if (typeof moduleDocs.seeAlso !== 'string') {
    problems.push('moduleDocs.seeAlso: expected a string');
  }
  expectNumber(moduleDocs.docblockWindow, 'moduleDocs.docblockWindow');

  const testSourceGreps = section('testSourceGreps');
  expectString(testSourceGreps.testsDir, 'testSourceGreps.testsDir');
  expectStrings(testSourceGreps.sourceDirs, 'testSourceGreps.sourceDirs');
  expectReasons(testSourceGreps.allowed, 'testSourceGreps.allowed');
  expectString(testSourceGreps.debtPrefix, 'testSourceGreps.debtPrefix');

  const git = section('git');
  expectString(git.remote, 'git.remote');
  expectString(git.defaultBase, 'git.defaultBase');
  expectString(git.worktreesDir, 'git.worktreesDir');
  expectStrings(git.install, 'git.install');

  const prBodyIn = section('prBody') as unknown as Record<string, unknown>;
  expectString(prBodyIn.templatePath, 'prBody.templatePath');
  expectString(prBodyIn.defaultBase, 'prBody.defaultBase');
  if (typeof prBodyIn.ciRuleSource !== 'string') {
    problems.push('prBody.ciRuleSource: expected a string');
  }
  const prBody: AgentErgonomicsConfig['prBody'] = {
    templatePath: prBodyIn.templatePath as string,
    defaultBase: prBodyIn.defaultBase as string,
    ciRuleSource: prBodyIn.ciRuleSource as string,
    checklistHeading: toPattern(
      prBodyIn.checklistHeading,
      'prBody.checklistHeading',
      problems,
    ),
    docPath: toPattern(prBodyIn.docPath, 'prBody.docPath', problems),
    testPath: toPattern(prBodyIn.testPath, 'prBody.testPath', problems),
  };

  const commitMsgIn = section('commitMsg') as unknown as Record<
    string,
    unknown
  >;
  expectNumber(commitMsgIn.subjectLengthLimit, 'commitMsg.subjectLengthLimit');
  expectStrings(commitMsgIn.types, 'commitMsg.types');
  expectString(commitMsgIn.badSubjectHint, 'commitMsg.badSubjectHint');
  expectString(commitMsgIn.example, 'commitMsg.example');
  const commitMsg: AgentErgonomicsConfig['commitMsg'] = {
    subjectLengthLimit: commitMsgIn.subjectLengthLimit as number,
    types: commitMsgIn.types as string[],
    badSubjectHint: commitMsgIn.badSubjectHint as string,
    example: commitMsgIn.example as string,
    badSubjects: toPattern(
      commitMsgIn.badSubjects,
      'commitMsg.badSubjects',
      problems,
    ),
    hopeful: toPattern(commitMsgIn.hopeful, 'commitMsg.hopeful', problems),
    gitGenerated: toPattern(
      commitMsgIn.gitGenerated,
      'commitMsg.gitGenerated',
      problems,
    ),
  };

  if (problems.length > 0) throw new ConfigError(problems, source);

  return {
    scriptsDir,
    runner,
    commands,
    help,
    gate,
    guardrails,
    docRefs,
    moduleDocs,
    testSourceGreps,
    git,
    prBody,
    commitMsg,
  };
}

/** The file names `loadConfig` looks for in the root when none is given. */
export const CONFIG_FILE_NAMES = [
  'agent-ergonomics.config.ts',
  'agent-ergonomics.config.js',
  'agent-ergonomics.config.mjs',
  'agent-ergonomics.config.json',
] as const;

export type LoadedConfig = { config: AgentErgonomicsConfig; path: string };

/**
 * Finds, imports and resolves the config. `path` is relative to `cwd`; with
 * none, the first of `CONFIG_FILE_NAMES` present in `cwd` is used. A module
 * config's default export is the object; a JSON file is the object itself.
 */
export async function loadConfig(
  path?: string,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  let file: string | undefined;
  if (path) {
    file = isAbsolute(path) ? path : resolve(cwd, path);
    if (!existsSync(file)) {
      throw new ConfigError([`no config file at ${file}`]);
    }
  } else {
    file = CONFIG_FILE_NAMES.map((name) => resolve(cwd, name)).find(
      (candidate) => existsSync(candidate),
    );
    if (!file) {
      throw new ConfigError([
        `no config found in ${cwd}: expected one of ${CONFIG_FILE_NAMES.join(', ')}, or pass --config <path>`,
      ]);
    }
  }

  let raw: unknown;
  if (file.endsWith('.json')) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError([`could not parse JSON (${error})`], file);
    }
  } else {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    raw = module.default;
    if (raw === undefined) {
      throw new ConfigError(['the module has no default export'], file);
    }
  }
  return { config: resolveConfig(raw, file), path: file };
}
