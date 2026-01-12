---
description: Run automated tests for a specific toy or all toys
---

# Testing Toys

This workflow helps agents test toy modules to ensure they function correctly.

## Quick Test Commands

// turbo-all

### Test All Toys

1. Run the full test suite:
```bash
bun test
```

2. Check toy metadata integrity:
```bash
bun run check:toys
```

3. Run type checks:
```bash
bun run typecheck
```

### Test a Specific Toy

1. To test a specific toy by slug (e.g., "holy"), run:
```bash
bun test tests/loader.test.js -t "holy"
```

2. Or create a focused test by running the sample toy test pattern:
```bash
bun test tests/sample-toy.test.ts
```

### Verify Toy Loads Correctly

1. Start the dev server:
```bash
bun run dev
```

2. Use the browser tools to navigate to `http://localhost:5173/toy.html?toy=<slug>` where `<slug>` is the toy's slug from `assets/js/toys-data.js`.

3. Verify:
   - The toy loads without console errors
   - The audio prompt modal appears (if the toy uses audio)
   - Demo audio plays when selected
   - The "Back to Library" button works

## Check Toy Module Contract

Every toy module should:

1. Export a `start({ container, canvas?, audioContext? })` function
2. Return a cleanup function or disposable object
3. Remove all DOM nodes when cleaned up

To verify a specific toy meets this contract, check:
```typescript
import { start } from './assets/js/toys/<toy-name>.ts';
expect(typeof start).toBe('function');
```

## Common Issues

- **Toy not found**: Ensure the slug is registered in `assets/js/toys-data.js`
- **Audio not working**: Check that `startAudio` and `startAudioFallback` are registered via `registerToyGlobals`
- **Blank canvas**: Verify the renderer is sizing correctly to `clientWidth`/`clientHeight`
