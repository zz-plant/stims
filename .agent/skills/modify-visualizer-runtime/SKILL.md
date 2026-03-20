---
name: modify-visualizer-runtime
description: "Modify the flagship visualizer runtime safely. Use when changing the shared runtime, loader, renderer, shell, controls, audio flows, capability checks, or routing around toy.html."
---

# Modify the visualizer runtime

Use this skill when the request changes how the main visualizer product behaves, not when the work is mainly about preset content.

## Start with current docs

- `docs/DEVELOPMENT.md`
- `docs/ARCHITECTURE.md`
- `docs/MILKDROP_PRESET_RUNTIME.md` when runtime changes touch preset execution
- `docs/PAGE_SPECIFICATIONS.md` when shell or launch flow behavior changes

## Focus areas

- shared runtime and lifecycle under `assets/js/core/`
- loader, route, and launch behavior around `toy.html`
- renderer selection, performance controls, and capability/preflight flows
- audio startup, shell controls, and app-level interaction behavior

Treat `toy=<slug>` as a loader detail, not the product boundary.

## Validation

Use the smallest useful check while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

Use browser-backed checks when runtime behavior depends on a real page or audio flow:

```bash
bun run test:integration
```

Before sign-off:

```bash
bun run check
```

## Browser check

If the change affects loading, controls, audio, or renderer behavior:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/toy.html?agent=true
```

Confirm the shell loads, audio entry still works, presets can start, and cleanup/navigation remain stable.
