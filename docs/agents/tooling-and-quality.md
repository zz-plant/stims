# Tooling and Quality Checks

## Bootstrap the repo state

When you are dropped into the repo without confidence about install state or recent drift, start with:

```bash
bun run setup:codex --status
bun run setup:codex --print-plan
bun run setup:codex
```

`setup:codex` installs dependencies and runs `bun run check:quick`. Repeated runs skip `bun install` when `node_modules` and the manifest fingerprint already look current. `bun run agent:status` prints the setup state and any managed session in one shot, and `bun run doctor` diagnoses a machine that cannot build, test or deploy.

## Warm loop

```bash
bun run dev:agent
```

One process runs the dev server, a quiet typecheck watcher, and the fast test profile (unit + compat) in watch mode; any of the three exiting stops the rest. Other dev modes:

| Command | What it runs | When to use |
| --- | --- | --- |
| `bun run dev` | Vite only | Visual QA at `http://localhost:5173/?agent=true` |
| `bun run dev:host` | Vite on the LAN | Testing from another device |
| `bun run dev:webgpu` | WebGPU-focused dev harness | WebGPU backend work |
| `bun run dev:ui` | Vite with `vite.config.ui.js` | Standalone component-harness work |

`.vscode/tasks.json` exposes the same loops as `agent:*` VS Code tasks.

### Optional: LM Studio sessions (`session:codex`, `model:codex`)

Both scripts drive personal `lmstudio-*` helper commands that the repo does not ship (`scripts/codex-session.sh`, `scripts/codex-model-route.sh`). No other script or gate depends on them.

- `bun run session:codex -- --profile <name>` starts a managed dev server, optionally a watcher, and warms local model roles. Profiles: `fast`, `review` (typecheck watcher), `compat`, `integration`, `parity`, `visual`, `full` (unit watcher). Without the helpers it prints a warning, skips the model warm-up, and still starts the server and watcher. Control it with `--status`, `--stop`, and `--port <n> --stop` for a non-default port.
- `bun run model:codex -- --mode auto --task "<task>"` routes a task description to a local model role. Without the helpers it exits with an error; `--no-exec` prints the routing plan only, and `--status` lists which helpers resolve.

Use `dev:agent` unless you have those helpers and want local models warm.

## Package manager

- Use **Bun** for installs and scripts: `bun install` when the lockfile is expected to change, `bun install --frozen-lockfile` for reproducible installs (CI), `bun run <script>` for everything else.
- Prefer `bun run test …` over raw `bun test`: the wrapper applies the preload, the test categories and the serial browser passes.

## Linting and formatting

Biome is the formatter and linter of record.

```bash
bun run lint       # check
bun run lint:fix   # apply fixes
bun run format     # format
```

## Quality gates

| Command | Tier | What runs | Time |
| --- | --- | --- | --- |
| `bun run check:quick` | Edit time; also the pre-commit hook | Changed-file lint, typecheck, and the guards; no tests | about 30 s |
| `bun run check` | Before every commit | Full Biome check, typecheck, every guard, package suites, then the gate tests (unit + compat + corpus) | 2–5 min |
| `bun run check:all` | Before merging compiler, renderer-adapter or parity work | Everything above plus the browser e2e suites | 5 min+ |

`check:quick` runs its independent steps in parallel; add `-- --serial` when debugging one. Inside a Claude Code session the gate prints one line per passing step (`--verbose` or `STIMS_QUIET=0` restores full output), and a failing step always prints in full. Every guard and its tier is listed in [`docs/GUARDRAILS.md`](../GUARDRAILS.md); test profiles and CI coverage are in [Testing](../TESTING.md).

`bun run verify --changed` (also `agent:verify`) reads the diff and runs only the guards, tests and regenerations those files can break.

## Task-specific checks

```bash
bun run test tests/path/to/spec.test.ts   # one file
bun run test:unit                          # unit only
bun run test:compat                        # preset and compatibility semantics
bun run test:e2e                           # every browser e2e suite (serial, slow)
bun run test:budget                        # gate tests leaning on bun's 5 s default timeout
bun run check:architecture                 # import cycles and the frontend → engine seam
bun run check:readme-claims                # README figures against the shipped catalog
bun run check:seo                          # SEO surface and generated learn pages
```

`bun run test:integration` runs one file, `tests/e2e/agent-integration.test.ts` (the agent API and the `play:toy` smoke). For the e2e file that covers a given surface, see [`verify-visualizer-work`](../../.agent/skills/verify-visualizer-work/SKILL.md#pick-tests-by-what-changed).

## Docs-only updates

Run `bun run check:doc-references` and `bun run check:readme-claims`. Typecheck and tests can be skipped unless the edit changes commands, paths, or workflow-critical instructions; verify any command you document by running it.

## Finding a command

```bash
bun run help          # every script, grouped by namespace, with a one-line purpose
bun run help --json   # the same index as {name, command, purpose} records
bun run help --for "<symptom>"   # symptom → the script that measures it
```

Purpose lines come from the docblock atop each script, so the index cannot drift from the code (`bun run check:script-docs` enforces it). Namespaces this page does not cover: `parity:`, `sweep:`, `perf:`, `bench:`, `profile:`, `catalog:`, `previews:`, `lab:`.

To drive a running visualizer, use the agent API rather than DOM scraping — see [`browser-automation.md`](./browser-automation.md), plus `bun run ctl` (one-shot CLI) and `bun run mcp` (MCP server).
