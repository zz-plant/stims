# tests/

`scripts/run-tests.ts` puts a test file in a category by the folder it sits in, and each profile is a set of categories. [Testing](../docs/TESTING.md) has the commands, gates and the evidence each kind of change needs.

| Folder | What it holds | Profiles that run it |
| --- | --- | --- |
| `unit/` | Logic, React components (`.test.tsx`), guard and lab scripts, the MCP server. Runs under happy-dom. | `fast`, `gate`, `all`, `unit` |
| `compat/` | Renderer preference and WebGPU rollout contracts. | `fast`, `gate`, `all`, `compat` |
| `corpus/` | Whole-corpus and reference checks: compile support across the bundled presets, parity diffs, the certification corpus, flash risk. Slow. | `gate`, `all`, `corpus` |
| `e2e/` | Real Chromium through Playwright against a dev server, one process per file, each file on its own port (`check:e2e-ports`). | `all`, `e2e` |

`fast` (unit + compat) is what a bare `bun run test` runs. `bun run check` runs `gate`, and `bun run check:all` runs `all`. The `integration` profile is the single file `e2e/agent-integration.test.ts`. A file that imports `browserTest` from `test-helpers.ts` drives a real browser, so the runner moves it to a serial pass in whatever folder it sits, and it skips when Chromium is not installed.

A test file placed directly in `tests/` belongs to no category, and the runner refuses to start until it moves.

## Finding the test for a change

Names follow the code under test: `milkdrop-*` for the engine and renderers, `preset-*` for preset loading, credit and sharing, `editor-*` for the editor panes, `app-shell-*` and `workspace-*` for the React shell, `check-*` for guard scripts.

```bash
rg -l "renderer-query-override" tests/   # tests that import or name a module
bun run test:changed                     # fast-profile tests affected by uncommitted changes
```

Expression semantics have their own instruments: `unit/eel-tier-differential.test.ts` and `unit/gpu-field-tier-differential.test.ts` hold the interpreter, JIT and GPU tiers to the same results, and `unit/eel-conformance-spec.test.ts` runs the portable cases in `packages/eel-conformance/cases/` (JSON; edit them there, not in the test).

The standalone packages keep their own suites in `packages/*/tests/`; run them with `bun run check:packages` or `bun --cwd packages/<name> test`. Tests in this directory cover what needs the rest of the repository, such as the bundled preset corpus.

## Support files

| Path | Purpose |
| --- | --- |
| `setup.ts` | Preloaded by `bunfig.toml`: installs the stand-ins from `environment/` (DOM, animation frames, WebGPU) and stubs for worker and worklet imports. |
| `test-helpers.ts` | `importFresh()`, `flushTasks()`, `replaceProperty()`, and `browserTest`, the gate for browser-backed files. |
| `frontend-harness.tsx` | Renders workspace panels against fake engine and workspace contexts. |
| `milkdrop-fixtures.ts`, `toy-test-helpers.ts`, `demo-toy.ts` | Shared catalog entries, fake audio nodes and a stand-in runtime module. |
| `e2e/*.ts` without `.test` | Dev-server, browser-availability and agent-API helpers for the e2e files. |
| `fixtures/` | `.milk` presets, native projectM reference renders (`fixtures/milkdrop/projectm-reference/`), flash-audit samples, Strudel patterns. |
| `accessibility/` | Lighthouse reports written by `bun run check:accessibility`; no tests. |
| `manual/` | Pages opened by hand on the dev server: `tile-lab.html` runs many engine instances at tile size, `probe-scratch-mesh.html` probes render-target shapes. |
