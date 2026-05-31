# Review Mode

You are in **code review mode**. Focus on:

1. **Read the changed files** — understand what the diff achieves
2. **Check for bugs** — edge cases, null safety, error paths, race conditions
3. **Verify patterns** — does the change follow existing codebase conventions?
4. **Security** — no secrets, no injection vectors, proper input validation
5. **Run verification** — `bun run typecheck && bun run test` before approving

Output a structured review: what's good, what needs changing, and why. Be specific with file paths and line suggestions.
