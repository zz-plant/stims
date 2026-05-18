# Modify visualizer runtime workflow

Use this runbook when a change touches shared runtime behavior, loader flow, renderer setup, shell controls, audio startup, capability checks, or canonical routing.

## 1. Read the current contract

- Read `.agent/skills/modify-visualizer-runtime/SKILL.md`.
- Check `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, and `docs/MILKDROP_PRESET_RUNTIME.md`.
- Check `docs/PAGE_SPECIFICATIONS.md` when shell, launch, or route behavior changes.

## 2. Make the smallest coherent runtime change

- Keep lifecycle, teardown, renderer selection, and audio startup changes together when they depend on each other.
- Preserve the canonical workspace route as the primary product surface.
- Add focused tests for the behavior that changed.

## 3. Verify during implementation

```bash
bun run test tests/path/to/spec.test.ts
bun run check:quick
```

Use browser-backed coverage when loading, audio, renderer, or controls depend on a real page:

```bash
bun run test:integration
```

## 4. Browser check

```bash
bun run dev
```

Open:

```text
http://localhost:5173/?agent=true
```

Confirm the shell loads, audio entry works, presets render, and navigation or teardown remains stable.

## 5. Sign off

```bash
bun run check
```
