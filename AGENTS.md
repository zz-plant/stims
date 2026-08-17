# Agent instructions

Full agent guidelines are at [.github/AGENTS.md](.github/AGENTS.md).

Quick essentials:
- **Package manager:** Bun — use `bun install`, `bun run <script>`
- **Warm dev loop:** `bun run dev:agent` (dev server + typecheck watch + fast tests watch)
- **Quality gate for JS/TS edits:** `bun run check`
- **Fast iteration gate:** `bun run check:quick`
- **Scoped verification:** `bun run verify --changed`
- **Command discovery:** `bun run scripts:list` (alias `bun run help`)
- **Visual testing:** `bun run dev` then visit `http://localhost:5173/?agent=true`
- **Commit format:** Conventional Commits
