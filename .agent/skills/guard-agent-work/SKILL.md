---
name: guard-agent-work
description: "Auto-guardrail for agent-authored changes. Use at the start of any coding session to prevent the most common agent mistakes in this repo."
---

# Guard Agent Work

Use this skill at the **start of every coding session** before writing or editing code. It prevents the mistakes that agents make most often in this repo.

## Why this exists

~38 of the last 400 commits were `codex/*` fix branches—agents fixing what previous agents got wrong. The same patterns repeat:
- Touching WebGPU parity code without testing both backends
- Adding path-string assertions that break on the next refactor
- Letting CSS literals slip in without tokens
- Forgetting to update MCP registrations when adding skills/docs
- Changing engine internals without touching the adapter boundary

This skill is a **mandatory pre-flight checklist** that runs automatically before you edit.

## Auto-detect: what are you about to change?

List your touched files, then map them to the guards below:

```bash
git status --short && git diff --name-only HEAD
```

| Touched paths | Guard to apply |
| --- | --- |
| `src/js/milkdrop/feedback-*`, `renderer-adapter*`, `compiler/*` | parity guard |
| `src/js/core/renderer-*`, `core/audio-handler.ts`, `milkdrop/runtime/backend-fallback.ts` | fallback guard |
| `src/js/frontend/*`, `src/css/*` | UI guard |
| `tests/*`, fixture-generating `scripts/*` | test guard |
| `.agent/skills/*`, `.agent/workflows/*` | MCP guard |
| `docs/*`, `AGENTS.md` | docs guard |

Note: this repo often has 2–3 agent sessions running at once, so `git status` may show files you did not touch. Diff before assuming a change is yours.

## Universal hard stops (always apply)

### 1. Never add `@ts-nocheck`

If you think you need it, you are wrong. Fix the type error or ask for help.

### 2. Never import across the engine boundary

`src/js/frontend/*` must not import from `src/js/milkdrop/runtime.ts`, `vm.ts`, or `compiler/*`. Only `milkdrop-engine-adapter.ts` is allowed.

### 3. Never leave `console.log` in production code

Use the debug snapshot system (`stimState.getDebugSnapshot`) or the agent API instead.

### 4. Never change a skill without updating MCP

If you touch `.agent/skills/*` or `.agent/workflows/*`, you must update:
- `scripts/mcp-shared.ts` (import + `markdownSources` + `agentCapabilities`)
- `docs/agents/custom-capabilities.md`
- `docs/agents/visualizer-workflows.md`

`bun run check:skill-index` enforces the first two for skills, so run it rather
than trusting the checklist — the guard was added after a skill shipped
unregistered, and it immediately found a second one (`perform-livecoding`) that
had never been served over MCP at all.

## Surface-specific guards

### Parity guard (`milkdrop/feedback-*`, `milkdrop/renderer-adapter*`, `compiler/gpu-descriptor-plan.ts`)

Before saving any file in this surface:

- [ ] Run `bun run test:compat` — does it pass?
- [ ] Run `bun run test tests/unit/milkdrop-renderer-adapter.test.ts` — does it pass?
- [ ] Did you add a comment explaining any new WebGPU vs. WebGL semantic difference?
- [ ] Did you measure against a reference preset — `bun run parity:capture` then
      `bun run parity:suite` — rather than eyeballing it in the browser? Judge
      the delta by `changeVerdict` against the preset's noise band, and never
      cite krash or glowsticks, whose references a black frame would pass.
- [ ] Did you sweep WebGL (`bun run sweep:milkdrop-loops -- --limit 40`) if you
      touched shared shader text? The parity suite is WebGPU-only, so a WebGL
      shader that no longer compiles passes it untouched.
- [ ] If you changed blend alpha order, did you add a regression test?

**Verify:** `bun run test:compat && bun run test tests/unit/milkdrop-renderer-adapter.test.ts`

Full procedure: [`close-parity-gap`](../close-parity-gap/SKILL.md).

### Fallback guard (`core/renderer-*`, `core/audio-handler.ts`, `milkdrop/runtime/backend-fallback.ts`)

Before saving any file in this surface:

- [ ] Can you draw the fallback state machine on a napkin? If not, refactor first.
- [ ] Did you trace renderScale from probe → plan → override → renderer?
- [ ] Did you test with `?renderer=webgl` forced?
- [ ] Did you test audio worklet init on the fallback path?
- [ ] Does every new timeout have a matching cleanup?

**Verify:** `bun run test tests/unit/renderer-setup.test.ts tests/unit/milkdrop-runtime-seams.test.ts`

### UI guard (`frontend/*`, `src/css/app-shell.css`)

Before saving any file in this surface:

- [ ] Did you check all four breakpoints (375/768/1024/1920)?
- [ ] Did you run `bun run check:quick` for CSS token violations?
- [ ] Did you verify the change in `?agent=true` mode, not just default?
- [ ] If you touched adapter interactions, did you check for stale closure / racing unmount?
- [ ] Did you avoid hardcoded colors/spacing without tokens?

**Verify:** `bun run check:quick && bun run check:css-tokens`

### Test guard (`tests/*`, `scripts/*` that generate fixtures)

Before saving any file in this surface:

- [ ] Are assertions behavior-based, not string/path-based?
- [ ] If you changed the harness, did you update the contract doc?
- [ ] Are fixtures generated by a script, not hand-edited?
- [ ] Did you add a regression test for any bug you fixed?
- [ ] Does `bun run test tests/your-file.test.ts` pass in isolation?

**Verify:** `bun run test:fast`

### MCP guard (`.agent/skills/*`, `.agent/workflows/*`)

Before saving any file in this surface:

- [ ] Did you import the markdown in `scripts/mcp-shared.ts`?
- [ ] Did you add it to `markdownSources`?
- [ ] Did you add it to `agentCapabilities`?
- [ ] Did you update `docs/agents/custom-capabilities.md`?
- [ ] Did you update `docs/agents/visualizer-workflows.md`?
- [ ] Did you run `bun run check:quick` to verify the build still compiles?

**Verify:** `bun run mcp:check && bun run check:quick`

### Docs guard (`docs/*`, `AGENTS.md`)

Before saving any file in this surface:

- [ ] Did you check for broken internal links? (`bun run check:seo` catches some)
- [ ] Did you update `docs/DOCS_MAINTENANCE.md` if the maintenance contract changed?
- [ ] Did you align with `docs/README.md` if routing/discoverability changed?
- [ ] Are code snippets copy-pasteable and use `bun run ...` not raw `bun test`?

**Verify:** `bun run check:stale-paths && bun run check:seo`

## The "what could go wrong?" prompt

Before any significant change, ask yourself:

```
Given the files I'm about to change, what is the most likely way
this breaks in production? What test or check would catch it?
```

If you can't answer both parts, do not proceed until you can.

## Emergency override

If you genuinely need to bypass a guard (e.g., emergency hotfix):

1. Write the override reason in the commit message
2. File a follow-up issue to remove the override
3. Update the guard if the override reveals a false positive

## Integration with session start

Add to your `.zshrc` or agent bootstrap:

```bash
alias codex='bun run agent:status && bun run session:codex'
```

Or add to `AGENTS.md` quick-start:

> Before editing, run `git diff --name-only HEAD` and apply the guard that matches the touched surface.

## Related skills

- [`review-webgpu-parity`](../review-webgpu-parity/SKILL.md) — deep parity review
- [`review-renderer-fallback`](../review-renderer-fallback/SKILL.md) — deep fallback review
- [`review-test-harness`](../review-test-harness/SKILL.md) — deep test review
- [`review-workspace-ui-state`](../review-workspace-ui-state/SKILL.md) — deep UI review
- [`audit-recurring-fixes`](../audit-recurring-fixes/SKILL.md) — refresh guards from commit history
