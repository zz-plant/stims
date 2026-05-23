---
description: Run full QA suite and summarize results
---

# QA Workflow

1. Run fast check first:

   ```bash
   bun run check:quick
   ```

2. Run full quality gate:

   ```bash
   bun run check
   ```

3. For visual/rendering changes, verify in browser:

   ```bash
   bun run dev
   # Open http://localhost:5173/?agent=true
   ```

4. If any gate fails: fix root cause, re-run. Do NOT chain fix-attempt commits.
