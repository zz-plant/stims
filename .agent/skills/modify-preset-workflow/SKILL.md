---
name: modify-preset-workflow
description: "Modify the visualizer's preset workflows. Use when changing bundled presets, preset catalog behavior, live editing, import/export, compatibility/parity, or preset metadata and fixtures."
---

# Modify preset workflows

Use this skill when the request is primarily about preset content or the systems that load, edit, browse, import, export, or validate presets.

## Start with current docs

- `docs/DEVELOPMENT.md`
- `docs/MILKDROP_PRESET_RUNTIME.md`
- `docs/ARCHITECTURE.md`
- `docs/PAGE_SPECIFICATIONS.md` when the preset browser or editor UI changes

## Focus areas

- bundled preset catalog and browser behavior
- live source editing and compile/runtime feedback
- import/export flows and compatibility expectations
- parity fixtures, metadata, and corpus-backed validation

Prefer changing shared preset infrastructure over treating individual presets as isolated product surfaces.

## Validation

Use targeted specs while iterating:

```bash
bun run test tests/path/to/spec.test.ts
```

Use compatibility or integration coverage when preset parsing, runtime support, or browser behavior changed:

```bash
bun run test:integration
bun run test:compat
```

Before sign-off:

```bash
bun run check
```

## Browser check

If the request affects preset browsing, editing, import/export, or playback transitions:

```bash
bun run dev
```

Open:

```text
http://localhost:5173/?agent=true
```

Confirm preset selection, playback, editor feedback, and any changed import/export flow behave as intended.
