---

description: "Run the fast quality gate (lint, typecheck, guards; no tests)"
agent: build
---

Run `bun run check:quick` from the repository root.

If it fails, report each failing step with its output, fix the root cause, and
run it again until it passes. Do not bypass the gate or the commit hook. If the
failure is in a file you did not touch, say so instead of editing it: another
session may own it.
