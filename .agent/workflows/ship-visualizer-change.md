# Ship visualizer change workflow

Use this runbook for a visualizer change that should finish PR-ready: implementation, tests, docs alignment, and final verification.

## 1. Gather context

- Read `.agent/skills/ship-visualizer-change/SKILL.md`.
- Open the skill or workflow for the affected surface: runtime, preset workflow, play, or test.
- Check `docs/agents/custom-capabilities.md` when agent-facing files change.

## 2. Implement the change

- Keep code, tests, fixtures, and docs synchronized.
- Preserve existing product routes and public claims unless the task explicitly changes them.
- Keep generated artifacts tied to the command that produced them.

## 3. Verify in layers

Run targeted checks first:

```bash
bun run test tests/path/to/spec.test.ts
bun run check:quick
```

Use browser or compatibility checks when the changed surface requires them:

```bash
bun run test:integration
bun run test:compat
```

## 4. Final gate

```bash
bun run check
```

For runtime, preset, audio, shell, or routing changes, also inspect:

```text
http://localhost:5173/?agent=true
```

## 5. Prepare handoff

Summarize the behavior changed, docs touched, artifacts regenerated, and exact validation commands run.
