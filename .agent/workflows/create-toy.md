---
description: Create a new toy with scaffold, metadata, docs, and validation
---

# Create a New Toy

## 1. Gather the required inputs

- slug
- display title
- toy type (`module` or page-backed)
- capabilities (`microphone`, `demoAudio`, `motion`, `requiresWebGPU`)

Read:

- `docs/TOY_DEVELOPMENT.md`
- `docs/agents/toy-development.md`

## 2. Scaffold first

```bash
bun run scripts/scaffold-toy.ts --slug <slug> --title "<Title>" --type module --with-test
```

Use manual creation only when the scaffold output is not a good fit.

## 3. Finish wiring

1. Verify the entry in `assets/data/toys.json`.
2. Verify the module under `assets/js/toys/`.
3. If metadata changed, regenerate artifacts:

```bash
bun run generate:toys
```

4. Update toy docs:
   - `docs/TOY_SCRIPT_INDEX.md`
   - `docs/toys.md`

## 4. Validate

```bash
bun run check:toys
bun run check
```

## 5. Browser smoke test

```bash
bun run dev
```

Open:

```text
http://localhost:5173/toy.html?toy=<slug>&agent=true
```

Confirm load, audio entry behavior, and cleanup.
