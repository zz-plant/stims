---
description: Update shared visualizer runtime behavior and validate it with current repo commands
---

# Modify the visualizer runtime

## 1. Confirm scope

1. Identify the product surface affected: loader, renderer, shell, controls, audio, capability checks, or routing.
2. Read the current implementation in the relevant `assets/js/core/`, `assets/js/loader/`, `assets/js/ui/`, or entrypoint files.
3. Read:
   - `docs/DEVELOPMENT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/MILKDROP_PRESET_RUNTIME.md` when preset execution is involved
   - `docs/PAGE_SPECIFICATIONS.md` when app-shell behavior changes

## 2. Implement

- preserve shared lifecycle and cleanup behavior
- prefer shared helpers over isolated product-surface patches
- treat `toy=<slug>` routing as an implementation detail

## 3. Validate incrementally

Run focused checks while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

Use real-browser coverage when needed:

```bash
bun run test:integration
```

## 4. Final validation

```bash
bun run check
```

## 5. Browser verification

```bash
bun run dev
```

Then open `http://localhost:5173/toy.html?agent=true` and confirm shell load, audio entry, preset startup, and navigation stability.
