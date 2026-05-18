# Modify preset workflow

Use this runbook when a change touches bundled presets, catalog/editor behavior, import/export, compatibility, parity fixtures, or preset metadata.

## 1. Scope the preset surface

- Read `.agent/skills/modify-preset-workflow/SKILL.md`.
- Check `docs/MILKDROP_PRESET_RUNTIME.md` and `docs/ARCHITECTURE.md` for the affected runtime contract.
- If the change affects visible preset browsing or editing, check `docs/PAGE_SPECIFICATIONS.md`.

## 2. Implement with fixtures in mind

- Keep preset parsing, catalog metadata, screenshots, and compatibility artifacts aligned.
- Prefer shared preset infrastructure fixes over one-off preset exceptions.
- Update tests or fixture data in the same change when behavior changes.

## 3. Verify while iterating

```bash
bun run test tests/path/to/spec.test.ts
```

Use compatibility or browser-backed coverage when the parser, renderer, editor, or catalog workflow changed:

```bash
bun run test:compat
bun run test:integration
```

## 4. Sign off

```bash
bun run check
```

For browser-visible preset work, also run the app and inspect:

```text
http://localhost:5173/?agent=true
```
