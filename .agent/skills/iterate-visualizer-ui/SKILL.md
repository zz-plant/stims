---
name: iterate-visualizer-ui
description: "Iterate on visualizer UI, workspace chrome, and CSS with fast feedback loops. Use when changing frontend components, styling, layout, or animation without needing the full MilkDrop runtime."
---

# Iterate Visualizer UI

Use this skill when you need fast visual feedback on workspace UI, shell chrome, toast, panels, controls, or CSS changes—without waiting for the full MilkDrop runtime to boot.

## Why this exists

The current workflow (`bun run dev` + `?agent=true`) is great for end-to-end preset behavior but slow for UI-only iteration. This skill provides:
1. **Component isolation** — mount workspace components without the engine
2. **Responsive preview grid** — see all breakpoints at once
3. **Fast HMR** — dedicated Vite server on port 5174

## Quick start

### 1. Start the UI iteration server

```bash
bun run dev:ui
```

This launches a secondary Vite server on port 5174. **The harness is at
`/ui-harness.html`, not at `/`** — the dev server's root is the repo root, so
`http://localhost:5174/` serves the ordinary app and silently ignores
`?component=`. Only the production build uses the harness as its entry.

What the harness gives you:
- HMR for `src/js/frontend/*` and `src/css/*`
- Component isolation harness
- Responsive preview grid

### 2. Open the iteration dashboard

```text
http://localhost:5174/ui-harness.html?component=WorkspaceStagePanel
```

**Query parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `component` | none | Registered component name; an unknown name reports itself |
| `props` | `{}` | JSON-encoded props override |
| `grid` | none | Comma-separated viewport widths (e.g. `375,768,1024,1920`) |

### 3. Edit and observe

1. Open a component file (e.g., `src/js/frontend/workspace-ui.tsx`)
2. Save → dashboard auto-refreshes the isolated component
3. Add `&grid=375,768,1024,1920` to see responsive behavior across breakpoints

## Component isolation

### Registered components

Two components are registered today — check
`COMPONENT_REGISTRY` in `src/js/frontend/ui-harness.tsx` rather than trusting
this list, and note the page footer prints the live set:

- `WorkspaceStagePanel` — the real component, wrapped with placeholder props
- `WorkspaceToast` — the real component, with a sample warn-tone message

These are the shipped components from `workspace-ui.tsx` with default props
supplied, not reimplementations, so layout and styling here are real. Anything
not registered renders an explicit "Unknown component" panel listing what is —
it used to fall back to the stage panel, which let you iterate confidently on
the wrong thing. Add a component by editing `COMPONENT_REGISTRY`.

### Mock data

Components mount inside a `WorkspaceProvider`, so context-dependent chrome
renders without the engine. Props come from the wrapper's defaults and are
overridable per URL with `&props={...}` (JSON). Read the wrappers at the top of
`src/js/frontend/ui-harness.tsx` for what each component is handed.

## Responsive preview grid

Render the same component at multiple viewports simultaneously:

```text
http://localhost:5174/ui-harness.html?component=WorkspaceStagePanel&grid=375,768,1024,1920
```

Each viewport is rendered in its own bordered container with a width label.

## Integration with full runtime

When you're ready to test in the real app:

```bash
bun run dev
```

Open `http://localhost:5173/?agent=true` and verify the same component in context.

## Common workflows

### Iterating on stage-panel layout

1. `bun run dev:ui`
2. Open `http://localhost:5174/ui-harness.html?component=WorkspaceStagePanel&grid=375,768,1024,1920`
3. Edit `src/js/frontend/workspace-ui.tsx`
4. See all breakpoints update simultaneously via HMR
5. Switch to `bun run dev` to verify in the full app

### Refactoring workspace layout for mobile

1. `bun run dev:ui`
2. Open `http://localhost:5174/ui-harness.html?component=WorkspaceStagePanel&grid=375,768`
3. Edit `src/js/frontend/workspace-ui.tsx` and `src/css/app-shell.css`
4. See mobile vs desktop behavior side by side
5. Commit with confidence

## Automated UI diff (pre-commit)

```bash
bun run ui:diff
```

Captures all registered components at all breakpoints using Playwright and reports:
- Per-component, per-breakpoint screenshots saved to `./screenshots/ui-diff/`
- Console error/warning counts
- JSON report at `./screenshots/ui-diff/report.json`

Requires the UI harness server to be running on `http://localhost:5174`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 5174 in use | Kill other process or edit `vite.config.ui.js` |
| Components don't update | Check browser console for HMR errors; restart `bun run dev:ui` |
| Styles missing | Confirm `src/css/app-shell.css` is imported in `ui-harness.html` |
| Full app looks different | The harness uses mocks; always verify in `bun run dev` before committing |

## Related skills

- [`verify-visualizer-work`](../../verify-visualizer-work/SKILL.md) — quick validation during implementation
- [`play-visualizer`](../../play-visualizer/SKILL.md) — full browser verification with runtime
- [`test-visualizer`](../../test-visualizer/SKILL.md) — run targeted tests and quality gate
