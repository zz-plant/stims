# Quick Start Skill

Use this skill when you are dropped into the repo cold and need the fastest safe path to productive work.

## When to use

- First entry into the repo for a new task
- After a long gap since last session
- When repo state is uncertain (new branch, pulled changes, etc.)

## 30-second bootstrap

```bash
# 1. Check if everything is already ready
bun run setup:codex --status

# 2. If not current, bootstrap
bun run setup:codex

# 3. Confirm the dev server URL
bun run session:codex -- --status
```

## If setup is current

```bash
# Start working immediately
bun run check:quick        # verify nothing is broken
bun run dev                # start dev server if browser QA needed
```

## If setup is stale or missing

```bash
# Full bootstrap (install + quick check)
bun run setup:codex

# Optional: start a warm long-lived session
bun run session:codex -- --profile review
```

## Next step: choose your work mode

| Situation | Next action |
|-----------|-------------|
| Task matches a known skill | Open the matching `.agent/skills/*/SKILL.md` |
| Task is exploration / spike | Read `docs/agents/reference-docs.md`, then code |
| Task is docs-only | Skip install checks; edit and verify links |
| Task spans multiple areas | Read `docs/agents/agent-handoffs.md` before splitting |

## Common mistakes to avoid

- **Don't** run `bun install` directly unless you know the lockfile must change. Use `bun run setup:codex` instead.
- **Don't** run the full `bun run check` while iterating. Use `bun run check:quick`.
- **Don't** test on `/milkdrop/` unless verifying the compatibility alias. Use `/?agent=true`.
- **Don't** skip browser verification for runtime, preset, audio, shell, or routing changes.

## One-liner status

```bash
bun run agent:status
```

This prints setup state + session state in one shot.
