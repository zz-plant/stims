---

description: "Run the full quality gate and the production build"
agent: build
---

Run these from the repository root, in order, and stop at the first failure:
1. `bun run check` — lint, typecheck, every guard, package suites, and the gate
   test suite (unit + compat + corpus).
2. `bun run build` — the production Vite build into `dist/`.

Report each command's result. On a failure, show the failing step's output and
fix the root cause before running the sequence again.
