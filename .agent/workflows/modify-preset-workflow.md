---
description: Update bundled preset workflows and validate catalog, editor, import/export, and compatibility behavior
---

# Modify preset workflows

## 1. Confirm scope

1. Identify whether the change affects preset cataloging, playback, live editing, import/export, or compatibility/parity.
2. Read the relevant implementation under `assets/js/milkdrop/`, `assets/js/core/`, and any touched fixtures or catalog assets.
3. Read:
   - `docs/DEVELOPMENT.md`
   - `docs/MILKDROP_PRESET_RUNTIME.md`
   - `docs/ARCHITECTURE.md`
   - `docs/PAGE_SPECIFICATIONS.md` when UI behavior changes

## 2. Implement

- keep preset behavior aligned with the shared runtime rather than special-casing individual entries
- update fixtures or metadata together with code when compatibility expectations change

## 3. Validate incrementally

Run focused specs first:

```bash
bun run test tests/path/to/spec.test.ts
```

Use broader coverage when needed:

```bash
bun run test:compat
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

Then open `http://localhost:5173/toy.html?agent=true` and confirm preset browse/play/edit flows behave correctly.
