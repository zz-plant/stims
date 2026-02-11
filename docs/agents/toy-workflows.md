# Toy Workflows and Commands

## Reusable agent workflows

The repository includes markdown workflows under `.agent/workflows/`:

- `/create-toy` — scaffold a new toy.
- `/play-toy` — run and manually verify a toy.
- `/test-toy` — execute toy-focused tests.
- `/ship-toy-change` — orchestrate implementation, checks, and metadata for toy updates.

## Common commands

```bash
# Scaffold a toy module and metadata/docs wiring
bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test

# Validate toy registration, entry points, and docs index
bun run check:toys

# Local development server
bun run dev

# Targeted and full test passes
bun run test tests/path/to/spec.test.ts
bun run test

# Type safety and full repo gate
bun run typecheck
bun run check
```

## Manual verification flow

1. Run `bun run dev`.
2. Open `http://localhost:5173/toy.html?toy=<slug>`.
3. Use demo audio if microphone access is unavailable.
4. Confirm render loop, controls, and cleanup behavior work as expected.
