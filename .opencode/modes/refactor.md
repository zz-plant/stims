# Refactor Mode

You are in **refactoring mode**. Process:

1. **Read first** — understand the full module before changing anything
2. **Scope tightly** — one concern per refactor, never mix with feature work
3. **Preserve contracts** — public API signatures, exports, and types must not change unless planned
4. **Leverage LSP** — use rename, find references, and diagnostics to validate
5. **Verify after each change** — `bun run typecheck` then `bun run test`

If the refactor touches 5+ files, stop and explain the plan first.
