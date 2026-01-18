# Agent Guidelines

These instructions apply to the entire repository.

## Core Conventions

- **Metadata conventions:**
  - **Commit messages:** Use concise, descriptive titles in sentence case (no trailing period) that summarize the change, e.g., `Add docs on data flow`.
  - **PR summaries:** Include a short summary plus explicit lists of tests run and any docs touched or added so reviewers can verify coverage.
  - **Docs map:** Refer to `docs/README.md` for an overview of the documentation structure when adding or updating documentation.
- Prefer **Bun** tooling to match `packageManager` (for installs use `bun install --frozen-lockfile` when dependencies change, and run scripts with `bun run ...`).
- For JavaScript/TypeScript changes, run the relevant quality checks before committing: `bun run check` (which runs Biome and tests) and `bun run typecheck`.
- **Tooling:** We use **Biome** for linting and formatting. Do not use ESLint or Prettier.
- For documentation-only changes (Markdown/prose), you can skip `bun run typecheck` and `bun run test`, but still run `bun run format` on touched docs.
- Keep the docs in `docs/` and the root `README.md` in sync with workflow or toy changes so contributors can find updated guidance.

## Toy Development

**Project Structure:**
- Toy modules: `assets/js/toys/` (TypeScript modules exporting `start()`)
- Toy registry: `assets/js/toys-data.js` (slugs, metadata, capabilities)
- Legacy HTML toys: `toys/` directory (standalone pages)
- Loader logic: `toy.html` + `assets/js/loader.ts`
- Audio handling: `assets/js/core/audio-handler.ts`

**Key Patterns:**
- Every toy module exports `start({ container, canvas?, audioContext? })`
- `start()` returns a cleanup function that removes all DOM nodes
- Audio reactivity uses `registerToyGlobals` to expose `startAudio` and `startAudioFallback`
- Toys support microphone input or demo audio fallback

## Workflows for Agents

Use these workflows (in `.agent/workflows/`) to interact with toys:

| Workflow | Command | Purpose |
|----------|---------|---------|
| `/create-toy` | Create new toy module | Scaffold a new toy with the standard template |
| `/play-toy` | Launch toy in browser | Start dev server and interact with toys |
| `/test-toy` | Run toy tests | Execute automated tests for toys |

### Quick Commands

```bash
# Create a new toy
bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test

# Check all toys are registered correctly
bun run check:toys

# Run all tests
bun test

# Start dev server for interactive testing
bun run dev

# Type check
bun run typecheck

# Full quality check (lint + tests)
bun run check
```

### Testing a Specific Toy

1. Start dev server: `bun run dev`
2. Navigate to: `http://localhost:5173/toy.html?toy=<slug>`
3. Click "Use demo audio" to bypass microphone permissions
4. Verify visuals render and respond to audio

### Common Toy Slugs

- `holy` - Ultimate Satisfying Visualizer
- `geom` - Geometry Visualizer  
- `spiral-burst` - Spiral Burst
- `neon-wave` - Neon Wave
- `milkdrop` - MilkDrop Proto

## Documentation

- `docs/TOY_DEVELOPMENT.md` - Full toy development playbook
- `docs/TOY_TESTING_SPEC.md` - Automated testing specification
- `docs/ARCHITECTURE.md` - System architecture overview
