---

name: verify-visualizer-work
description: "Choose and run the checks a change needs, from the edit-time loop to the full gate: targeted tests, the browser e2e file that covers the change, visual evidence with or without a GPU, and reproducing a CI failure. Use after code changes, before committing, or when validation is the task itself."
---

# Verify visualizer work

## The loop

| When                                                     | Command                                   | Time       |
| -------------------------------------------------------- | ----------------------------------------- | ---------- |
| After every significant edit                             | `bun run check:quick`                     | about 30 s |
| Behaviour changed                                        | `bun run test tests/path/to/spec.test.ts` | seconds    |
| Before committing                                        | `bun run check`                           | 2–5 min    |
| Before merging compiler, renderer-adapter or parity work | `bun run check:all`                       | 5 min+     |

`check:quick` lints and typechecks the changed files and runs the guards; it
runs no tests. `check` adds the full Biome pass, the package suites, and the
gate test suite (unit + compat + corpus). `check:all` adds the browser e2e
suites. [Testing](../../../docs/TESTING.md) lists every profile and what CI runs.

`bun run verify --changed` reads the diff and runs only the guards, tests and
regenerations those files can break.

When a gate fails, fix the root cause and rerun it. Do not stack fix-attempt
commits.

## Pick tests by what changed

| Change                                        | Tests                                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preset parsing, editor, catalog               | targeted unit test, then `bun run test:compat`                                                                                                                                                                                     |
| Compiler, EEL semantics, parity               | `bun run test:compat` and `bun run test:corpus`; `check:packages` covers `packages/milkdrop-toolchain`                                                                                                                             |
| Boot, renderer, backend fallback, audio start | `tests/e2e/agent-boot-smoke.test.ts` (boots and animates on each backend) and `tests/e2e/e2e-engine-mount.test.ts` (WebGL mount and preset switch); `tests/e2e/webgpu-engine-mount.test.ts` runs only on a machine with a real GPU |
| Preset switches and blends                    | `tests/e2e/feedback-continuity.test.ts`, `tests/e2e/preset-crossfade.test.ts`                                                                                                                                                      |
| Shell chrome, landing, routes                 | `tests/e2e/chrome-visual-contract.test.ts`, `tests/e2e/landing-route.test.ts`, `tests/e2e/open-one-up.test.ts`, `tests/e2e/studio-loop.test.ts`                                                                                    |
| iframe `postMessage` protocol                 | `tests/e2e/embed-bridge.test.ts`                                                                                                                                                                                                   |

Run one browser file with `bun run test tests/e2e/<file>.test.ts`, or every
one with `bun run test:e2e` (serial, several minutes). `bun run test:integration`
runs a single file, `tests/e2e/agent-integration.test.ts` (the agent API and the
`play:toy` smoke), so it is not general browser coverage.

Browser tests skip when Playwright's Chromium is missing; `bun run setup:browsers`
fixes that. A skipped browser test is not a passing one.

## Reproducing a failure

- Start from the exact command that failed (CI log, issue, report) and record
  its first error before changing anything.
- `bun run test -- --no-bail <files>` reports every failing file in one run
  instead of stopping at the first.
- A test that times out only under load is usually CPU-bound against bun's
  5 s default: `bun run test:budget` lists the gate tests at risk. Rerun the
  file alone before treating it as a regression.
- Use `bun run test`, not raw `bun test`: the wrapper applies the preload,
  categories and serial passes.

## Visual verification

Pick the tier your environment supports instead of skipping the step:

| Environment                              | Use                                                                               | What you get                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GUI browser                              | `bun run dev`, then `http://localhost:5173/?agent=true`                           | Full visual and UX confirmation                                                                                                                                  |
| No browser                               | `bun run lab:reactivity -- --preset <id>`                                         | Numeric audio-reactivity verdicts in about 15 s                                                                                                                  |
| Headless, no confirmed GPU               | `bun run ctl -- --screenshot out.png` or `bun run mcp` (`session_describe_frame`) | A screenshot plus brightness and colour metrics; both default to software rendering, so they do not return a silent black canvas                                 |
| Headless with vision                     | `bun run lab:visual -- --preset <id>`                                             | Pixel metrics and contact-sheet PNGs                                                                                                                             |
| Shell or chrome changes, any environment | `bun run ui:diff`                                                                 | Component screenshots diffed against a local baseline; no GPU involved. The first run creates the baseline and `-- --update-baseline` accepts an intended change |

[Visual testing](../../../docs/agents/visual-testing.md#cloudsandboxed-agents-without-a-gpu)
says which tools need a GPU. [Browser automation](../../../docs/agents/browser-automation.md)
documents the URL flags and the `__stims_agent` API for asserting state instead
of eyeballing it.

Manual checklist:
- [ ] No console errors or `getState().lastError`
- [ ] The preset reacts to audio (`?mockAudio=demo` when no microphone is available)
- [ ] Changed controls work
- [ ] Layout holds at 375, 768, 1024 and 1920 px wide (or `bun run ui:diff` headless)

## Specialised checks

```bash
bun run check:architecture    # import cycles and the frontend → engine seam
bun run check:seo             # SEO surface and generated learn pages
bun run check:readme-claims   # README figures against the shipped catalog
bun run check:production-edge # the deployed site's edge (network; not in the gate)
```

## Common issues

| Symptom                                         | Fix                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Changes do not appear in the browser            | Restart `bun run dev`; another session may own `:5173`                                                                    |
| Black canvas, no error                          | The tab is hidden and the URL lacks `?agent=true`; check `getState().renderingSuspended`                                  |
| Type errors only in `bun run check`             | Run `bun run typecheck` to see them in isolation                                                                          |
| `check:quick` fails on a file you did not touch | Another session's work; see [agent handoffs](../../../docs/agents/agent-handoffs.md#working-in-a-tree-with-other-writers) |
