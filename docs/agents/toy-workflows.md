# Toy Workflows & Commands

## Agent workflows

Use these workflows (in `.agent/workflows/`) to interact with toys:

| Workflow | Command | Purpose |
| --- | --- | --- |
| `/create-toy` | Create new toy module | Scaffold a new toy with the standard template |
| `/play-toy` | Launch toy in browser | Start dev server and interact with toys |
| `/test-toy` | Run toy tests | Execute automated tests for toys |

## Quick commands

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

## Testing a specific toy

1. Start dev server: `bun run dev`
2. Navigate to: `http://localhost:5173/toy.html?toy=<slug>`
3. Click "Use demo audio" to bypass microphone permissions
4. Verify visuals render and respond to audio

## Common toy slugs

- `holy` - Ultimate Satisfying Visualizer
- `geom` - Geometry Visualizer
- `spiral-burst` - Spiral Burst
- `neon-wave` - Neon Wave
- `milkdrop` - MilkDrop Proto
