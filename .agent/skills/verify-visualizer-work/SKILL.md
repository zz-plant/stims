# Verify Visualizer Work

Use this skill during implementation to validate your changes before committing.

## When to use

- After making code changes to check that nothing broke
- Before running the full `bun run check` gate
- When you need quick feedback on runtime, UI, or preset behavior
- During iterative development to catch regressions early
- To verify visual changes or behavioral changes directly in the browser

## Quick verification loop

Use this checklist during implementation to prevent surprises at the final quality gate:

### 1. Syntax and type safety (< 30 seconds)

```bash
bun run check:quick
```

Validates:
- No TypeScript errors
- No Biome lint/format issues
- No `@ts-nocheck` violations
- `public/milkdrop-presets/catalog.json` is in sync

**When to use**: After every significant edit to catch immediate errors.

### 2. Targeted tests (1-2 minutes)

Run tests for the specific area you changed:

```bash
# For runtime/loader/shell/renderer changes
bun run test:integration

# For preset/editor/catalog changes
bun run test:compat

# For specific test file
bun run test tests/path/to/spec.test.ts

# For all unit tests only
bun run test:unit
```

**When to use**: After changes that affect behavior, not just cosmetics.

### 3. Visual verification (< 1 minute)

Launch the visualizer locally to see your changes live:

```bash
bun run dev
```

Then visit:
- `http://localhost:5173/` — Canonical workspace route
- `http://localhost:5173/?agent=true` — Agent testing mode on the canonical route (persistent state, cleaner UI for QA)
- `http://localhost:5173/milkdrop/?agent=true` — Compatibility-alias verification

**Visual checklist**:
- [ ] No console errors (open DevTools F12)
- [ ] Audio visualization is responsive
- [ ] UI controls work as expected
- [ ] Presets load and play correctly (if preset-related changes)
- [ ] Mobile/responsive layout is intact (resize browser)

### 4. Full quality gate (2-5 minutes)

When you're confident in your changes:

```bash
bun run check
```

This runs the production-ready validation:
- `check:quick` checks
- Full TypeScript typecheck
- All tests (unit + integration + compat)
- Architecture boundary verification
- SEO surface validation
- Toy manifest consistency

**When to use**: Before pushing to a PR or final commit.

## Verification by task type

### Adding a new feature
1. `bun run check:quick` — type/lint safety
2. `bun run test tests/path/to/new.test.ts` — your tests pass
3. `bun run dev` + manual browser test — feature works visually
4. `bun run check` — full suite passes

### Fixing a bug
1. `bun run check:quick` — syntax is clean
2. `bun run test tests/path/to/regression.test.ts` — specific test passes
3. `bun run dev` + browser test — bug is fixed
4. `bun run check` — nothing broke

### Updating presets or catalog
1. `bun run check:quick` — lint/types
2. `bun run test:compat` — compat tests pass
3. `bun run dev` + test preset in browser — loads and plays
4. `bun run check` — full gate passes

### UI/styling changes
1. `bun run check:quick` — syntax only
2. `bun run dev` — launch browser at `?agent=true` URL
3. Test across:
   - [ ] Desktop (1920px+)
   - [ ] Tablet (768px-1024px)
   - [ ] Mobile (375px-480px)
   - [ ] Dark and light modes
4. `bun run check` — full gate

### Runtime/renderer changes
1. `bun run check:quick` — syntax
2. `bun run test:integration` — integration suite
3. `bun run dev` + play with different presets in browser
4. `bun run check` — full gate

## Testing in isolation

### Play a specific preset during dev

```bash
bun run play:toy milkdrop
```

This launches a dev server specifically focused on the MilkDrop visualizer without other distractions.

### Run tests in watch mode

```bash
bun run test:watch
```

Re-runs tests automatically when files change—great for iterating on fixes.

### Architecture or SEO issues?

```bash
# Check for architectural boundary violations
bun run check:architecture

# Check SEO surface integrity
bun run check:seo

# Check toy manifest alignment
bun run check:toys
```

## Common issues and quick fixes

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| Changes don't appear in browser | Build is stale or dev server crashed | Stop dev server, run `bun run dev` again |
| Tests pass locally but fail in `bun run check` | Missing dependency or environment difference | Run full `bun run check` to rule out isolated test environment issues |
| Type errors only appear in `bun run check` | Project references or monorepo caching | Run `bun run typecheck` to debug |
| Catalog is out of sync | Changes to presets without updating manifest | Run `bun run check:quick` which auto-validates |

## Next steps

- Use [`../workflows/test-visualizer.md`](../workflows/test-visualizer.md) for a more detailed testing runbook
- Use [`../workflows/ship-visualizer-change.md`](../workflows/ship-visualizer-change.md) for the full implementation→validation→PR-ready flow
- See [`../../docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) for all available scripts
