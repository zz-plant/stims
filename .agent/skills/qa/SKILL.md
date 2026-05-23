---
name: qa
description: Run the Stims quality gate. Knows the fast→full iteration loop and visual verification.
---

# QA Skill

## Iteration loop (fast → full)

```bash
# 1. Syntax + types + lint (15s)
bun run check:quick

# 2. Targeted test (30-90s)
bun run test tests/path/to/spec.test.ts

# 3. Visual verification
bun run dev
# Open http://localhost:5173/?agent=true

# 4. Full quality gate (before commit, 2-5 min)
bun run check
```

## Specialized checks

```bash
bun run check:architecture    # Cross-boundary import violations
bun run check:toys            # Preset manifest drift
bun run check:seo             # SEO surface health
bash scripts/check_production_edge.sh   # WAF/DNS health
```

## Output

- [ ] check:quick passed
- [ ] Visual verification on agent route (if UI/preset changes)
- [ ] check (full gate) passed
