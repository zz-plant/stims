# agent-ergonomics

Repository tools for coding agents: a script index generated from docblocks, symptom-to-tool
routing, a quiet quality gate, documentation guards and Git workflow helpers. One Bun CLI reads
one configuration file. The library has no runtime dependencies and does not depend on Stims.

This package is prepared for publication at version 0.1.0. It has not been published to npm or
mirrored to a separate repository. The Stims scripts already use its workspace source.

## Run it

Bun 1.2 or later is required, including for the built CLI. From a checkout of this package:

```sh
bun install
bun run build
bun dist/cli.js --cwd /absolute/path/to/your/repo help
```

After installing the package, the same command is `agent-ergonomics help`. Use `--config <file>`
to select a configuration explicitly and `--cwd <root>` to select the repository. The default
search checks `agent-ergonomics.config.ts`, `.js`, `.mjs` and `.json` in that order in the selected
root. Relative config paths and every command's repository paths resolve from that root.

A JavaScript or TypeScript config exports an object as its default. `defineConfig` provides types;
`loadConfig` validates it and applies defaults. JSON contains the object directly, with pattern
strings in place of regular expressions. Unknown fields, invalid patterns, malformed steps and
allowlist entries without reasons fail with the field names that need fixing.

```ts
import { defineConfig } from 'agent-ergonomics';

export default defineConfig({
  help: {
    title: 'Project scripts',
    prefixNotes: { check: 'quality checks', test: 'test suites' },
    routes: [
      {
        when: ['wrong output', 'regression'],
        run: ['test'],
        note: 'Reproduce the behavior with the test suite before editing.',
      },
    ],
    noMatchPointers: [
      { name: 'README.md', text: 'setup and contribution workflow' },
    ],
  },
  gate: {
    concurrent: [
      { label: 'Lint', cmd: ['bun', 'run', 'lint'] },
      { label: 'Types', cmd: ['bun', 'run', 'typecheck'] },
    ],
    postflight: { full: [{ label: 'Tests', cmd: ['bun', 'run', 'test'] }] },
  },
  docRefs: { roots: ['docs'], extraFiles: ['README.md'] },
  testSourceGreps: {
    allowed: {
      'tests/shipped-html.test.ts':
        'The HTML text is the artifact this project delivers.',
    },
  },
});
```

The example assumes the named scripts exist in your `package.json`. Put each script's purpose in
the first paragraph of its file-level `/** ... */` comment; later paragraphs explain the incident
or constraint behind it. The index and generated guardrails page read those comments directly.
The package's exported configuration types document every field and default.

## Commands

| Command             | Behavior and options                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help`              | Group scripts by namespace. `--json` emits the same index, `--for "symptom"` ranks configured routes then keyword matches, and `--check` rejects missing script summaries.                         |
| `gate`              | Run preflight serially, independent checks concurrently, then postflight. Full mode is default; `--quick`, `--all`, `--serial`, `--no-tests`, `--quiet`, `--verbose` and `--json` select behavior. |
| `guardrails`        | Generate the configured Markdown page from `check:*` docblocks and gate membership; `--check` compares it without writing.                                                                         |
| `doc-refs`          | Check live Markdown references to configured path prefixes and package scripts, honoring explicit historical/generated exemptions.                                                                 |
| `module-docs`       | Require useful introductions above a configured size threshold, and retire backlog entries when documented or deleted.                                                                             |
| `test-source-greps` | Reject tests that read production source as text, except paths carrying an explicit reason.                                                                                                        |
| `branch-restart`    | Restart a feature branch after a squash merge. Refuse dirty or unpushed work; `--branch`, `--base` and `--dry-run` select the operation. Never push.                                               |
| `worktree-new`      | Create a separate checkout from the fetched base. Take a branch, optional `--base`, `--path` and `--no-install`. Never reset an existing branch.                                                   |
| `pr-body`           | Scaffold a description from commits and changed files; `--base` and `--footer` customize it. `--check <file\|->` validates a finished body. Never assert checks were run.                          |
| `commit-msg`        | Check a message file or stdin (`-`), or `--range <base>..<head>`. Long subjects warn in hook mode; `--allow-long-subjects` waives the range ceiling. `--pr-title <title>` checks a title as its squash subject. |

`--help` lists the commands without loading a config. Read-only checks return zero on success and
nonzero on failure; the CLI returns 2 for configuration or invocation errors. `guardrails` writes
only when `--check` is absent. Git helpers change only the checkout they are asked to operate on;
the caller remains responsible for authorizing a restart or worktree creation.

## Configuration sections

- `help`: banner, prefix notes, symptom routes, unmatched-query pointers and docblock opener window.
- `gate`: mode-specific step lists, agent/quiet environment names and summary label. A step can set
  `modes` and an `envCmd` override for a named environment variable. `--no-tests` drops only
  postflight steps. Quiet mode hides passing output and preserves failure details.
- `guardrails`: destination, guard prefix/exclusions, introduction, gate names and docblock window.
- `docRefs`: scanned roots/files, path prefixes, historical/proposal/placeholder patterns and
  generated-document exemptions.
- `moduleDocs`: source glob, size and summary thresholds, shrink-only backlog and guidance link.
- `testSourceGreps`: test/source directories, reasoned exemptions and the known-debt prefix.
- `git`: remote, default base, worktree directory and install command.
- `prBody` and `commitMsg`: template/reference patterns and commit subject policy.
- `commands`, `runner` and `scriptsDir`: repository wrapper names, script runner and script directory.

`parseDocblock()` is shared by help, guardrails and module documentation checks. It preserves inline
text and the full rationale, supports CRLF and shebangs, and limits where the opener may appear.
Consumers choose their opener window: help defaults to 30 lines, the guards to 10. The closer may
appear later, so a long explanation remains documented.

## Why these tools exist

- **Indexes that cannot drift.** Generate discovery text from the code and fail when the source
  lacks a summary. Keep policy in one config rather than copying tables across wrappers.
- **Guards that explain their incident.** A rule should say which failure it prevents. Generate
  its explanation where newcomers can find it before tripping the rule.
- **Rules scoped to the change.** Use a quick mode for changed-file checks and reserve broader
  work for full/all modes. A new rule should not require unrelated cleanup to make progress.
- **Exemptions that record a reason.** Keep unavoidable artifact reads separate from known debt.
  An allowlist is a record of a deliberate exception, not a way to hide a red check.
- **Quiet output for agents.** Passing checks need one line. Failures need their complete evidence.
  Keep verbose output available for humans and CI, and JSON available for tooling.
- **Symptoms routed to instruments.** Someone can know every script and still choose the wrong
  measurement. Curated routes carry the judgment a generated list cannot supply.

Documentation follows progressive disclosure: begin with a short entrypoint, then open only the
relevant guide or skill. The CLI supplements those guides with executable facts.

## Library and development

The public entrypoint exports `loadConfig`, `resolveConfig`, `parseDocblock`, command runners,
`buildGatePlan`, `runGate`, guard functions and Git helpers. Runners accept a context with root,
config, environment, stdin reader and output functions, and return an exit code without terminating
the caller. `runCli` supplies the same behavior for programmatic CLI tests.

```sh
bun run typecheck
bun test
bun run build
```

Tests include the original Git helper, PR body and gate-output behavior cases, plus fixture-based
config loading, command dispatch and guard checks. Git tests create disposable local repositories;
they do not push or alter the developer's repository. Stims keeps its policy tests for the wrappers,
including its routes, gate modes and hook integration.

License: [Unlicense](LICENSE).
