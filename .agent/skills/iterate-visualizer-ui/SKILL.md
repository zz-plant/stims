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

This launches a secondary Vite server at `http://localhost:5174/` with:
- HMR for `assets/js/frontend/*` and `assets/css/*`
- Component isolation harness
- Responsive preview grid

### 2. Open the iteration dashboard

```text
http://localhost:5174/?component=WorkspaceLaunchPanel
```

**Query parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `component` | `WorkspaceLaunchPanel` | Component to render |
| `props` | `{}` | JSON-encoded props override |
| `grid` | none | Comma-separated viewport widths (e.g. `375,768,1024,1920`) |

### 3. Edit and observe

1. Open a component file (e.g., `assets/js/frontend/workspace-ui.tsx`)
2. Save → dashboard auto-refreshes the isolated component
3. Add `&grid=375,768,1024,1920` to see responsive behavior across breakpoints

## Component isolation

### Registered components

The harness exposes mock wrappers for these components:
- `WorkspaceLaunchPanel` — launch/shell chrome
- `WorkspaceStagePanel` — stage frame with ambient chrome
- `WorkspaceToolSheet` — browse/settings sheet panel
- `WorkspaceToast` — toast notifications

Add more by editing `assets/js/frontend/ui-harness.tsx` and updating `COMPONENT_REGISTRY`.

### Mock data

The harness provides default mocks for:
- `catalog` (4 bundled presets with certification metadata)
- `routeState` (static URL state)
- `presetPreviews` (empty)
- `recentYouTubeVideos` (empty)

Override via query params or edit the harness file directly.

## Responsive preview grid

Render the same component at multiple viewports simultaneously:

```text
http://localhost:5174/?component=WorkspaceToolSheet&grid=375,768,1024,1920
```

Each viewport is rendered in its own bordered container with a width label.

## Integration with full runtime

When you're ready to test in the real app:

```bash
bun run dev
```

Open `http://localhost:5173/?agent=true` and verify the same component in context.

## Common workflows

### Iterating on launch panel layout

1. `bun run dev:ui`
2. Open `http://localhost:5174/?component=WorkspaceLaunchPanel&grid=375,768,1024,1920`
3. Edit `assets/js/frontend/workspace-ui.tsx`
4. See all breakpoints update simultaneously via HMR
5. Switch to `bun run dev` to verify in the full app

### Refactoring workspace layout for mobile

1. `bun run dev:ui`
2. Open `http://localhost:5174/?component=WorkspaceStagePanel&grid=375,768`
3. Edit `assets/js/frontend/workspace-ui.tsx` and `assets/css/app-shell.css`
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
| Styles missing | Confirm `assets/css/app-shell.css` is imported in `ui-harness.html` |
| Full app looks different | The harness uses mocks; always verify in `bun run dev` before committing |

## Related skills

- [`verify-visualizer-work`](../../verify-visualizer-work/SKILL.md) — quick validation during implementation
- [`play-visualizer`](../../play-visualizer/SKILL.md) — full browser verification with runtime
- [`test-visualizer`](../../test-visualizer/SKILL.md) — run targeted tests and quality gate
