---
name: modify-visualizer-runtime
description: "Modify the flagship visualizer runtime safely. Use when changing the shared runtime, loader, renderer, shell, controls, audio flows, capability checks, or canonical-route behavior."
---

# Modify the visualizer runtime

Use this skill when the request changes how the main visualizer product behaves, not when the work is mainly about preset content.

## Start with current docs

- `docs/DEVELOPMENT.md`
- `docs/ARCHITECTURE.md`
- `docs/MILKDROP_PRESET_RUNTIME.md` when runtime changes touch preset execution
- `docs/PAGE_SPECIFICATIONS.md` when shell or launch flow behavior changes

## Focus areas

- shared runtime and lifecycle under `src/js/core/`
- loader, route, and launch behavior around the canonical workspace entry
- renderer selection, performance controls, and capability/preflight flows
- audio startup, shell controls, and app-level interaction behavior

Use the canonical `/` workspace route; `/milkdrop/` is a redirect alias.

## Validation

Use the smallest useful check while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

When the behaviour depends on a real page, a backend or the audio flow, run the
browser e2e file that covers it, for example:

```bash
bun run test tests/e2e/agent-boot-smoke.test.ts tests/e2e/e2e-engine-mount.test.ts
```

[`verify-visualizer-work`](../verify-visualizer-work/SKILL.md#pick-tests-by-what-changed)
maps each surface to its e2e file.

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
http://localhost:5173/?agent=true
```

Confirm the shell loads, audio entry still works, presets can start, and cleanup/navigation remain stable.
