# Front-end performance bottlenecks

This note captures the highest-impact front-end performance risks found during a static audit of the Stims runtime. It focuses on hot paths that execute every frame, on user input, or on overlay/catalog refreshes.

## Highest-priority bottlenecks

### 1. Per-frame VM and renderer data reconstruction

The MilkDrop runtime rebuilds large visual payloads on every animation tick:

- `MilkdropPresetVM.step()` rebuilds the frame state, including waves, mesh geometry, motion vectors, shapes, borders, shader controls, and a full variable snapshot on each frame.
- `buildMainWave()` allocates a new `positions` array sized to the current sample count and also copies `smoothedSamples` into `lastWaveSamples` every frame.
- `buildMesh()` and `buildMotionVectors()` rebuild arrays for line geometry each frame.

Why this matters:

- These allocations happen in the hottest path of the application.
- The work scales with quality settings (`mesh_density`, detail scale, motion vector counts, wave sample counts).
- This raises GC pressure and makes frame pacing more fragile on mobile or integrated GPUs.

Recommended follow-up:

- Reuse typed buffers for wave, mesh, and motion-vector positions instead of allocating fresh arrays each frame.
- Avoid creating the full `variables` snapshot unless the inspector or debugging tools actively need it.
- Consider splitting “simulation state” from “render payload” so only changed structures are rebuilt.

### 2. Object-spread churn in the per-frame runtime update

`createMilkdropExperience().update()` merges runtime signals with:

- a freshly-built input override object,
- optional signal overrides,
- blend-state wrapper objects,
- low-quality post-processing override objects.

`buildMilkdropInputSignalOverrides()` also computes the same drag magnitude twice for camelCase and snake_case fields.

Why this matters:

- The update path already performs substantial VM and rendering work.
- Repeated object spreads add avoidable allocations every frame.
- Duplicate math and object creation add overhead without improving output quality.

Recommended follow-up:

- Reuse a mutable signal object and update fields in place.
- Compute drag magnitude once and assign it to both aliases.
- Move low-quality and blend-state toggles toward in-place flag updates or adapter-side branching.

### 3. Full overlay browse-list re-rendering on every filter/search/catalog update

The MilkDrop overlay rebuilds the entire browse DOM tree whenever search text changes, sort/filter selections change, collection filters change, or the preset catalog is refreshed.

Why this matters:

- Search uses the `input` event, so a full re-render runs on every keystroke.
- `renderBrowseList()` recreates rows, buttons, select controls, and warning blocks instead of diffing or reusing DOM nodes.
- The cost grows with the preset catalog size and can compete with the active render loop when the overlay is open.

Recommended follow-up:

- Debounce search input.
- Cache row elements by preset id and patch only changed fields.
- Keep overlay chrome (for example collection filters) stable when browse options have not changed.
- Separate sorting/filtering from DOM updates so unchanged rows can be retained.
- Consider virtualizing long browse lists if the catalog keeps growing.

### 4. Catalog refreshes cascade into expensive UI work

`syncCatalog()` repopulates the overlay catalog and triggers both collection-filter rebuilding and browse-list rendering. It is called after favorite/rating changes, imports, deletions, startup, preset selection, and editor-session updates.

Why this matters:

- The same expensive browse rebuild can happen repeatedly during interactive workflows.
- `session.subscribe()` calls `syncCatalog()` after editor changes, even though most editor edits do not fundamentally change the catalog contents.
- This creates avoidable main-thread work while the visualizer is already animating.

Recommended follow-up:

- Distinguish “catalog metadata changed” from “editor source changed”.
- Only refresh the active row when rating/favorite state changes.
- Coalesce queued catalog refreshes to the latest requested state before they hit the overlay.
- Throttle or batch catalog refreshes behind `requestAnimationFrame()` or a microtask queue.

### 5. Inspector work still performs string-heavy summaries in active sessions

When the inspector tab is open, `setInspectorState()` assembles a large HTML string containing compatibility, feature, and frame metrics, then writes it with `innerHTML` on a throttled cadence.

Why this matters:

- The method reads many nested runtime fields and performs multiple joins/string interpolations.
- Even throttled, it competes with rendering on slower devices.
- It encourages the runtime to continue producing rich per-frame diagnostic state.

Recommended follow-up:

- Render inspector fields once and patch only changing metric text nodes.
- Reduce the diagnostic payload while animation is running.
- Consider a lower refresh rate for diagnostics than for visuals.

## Secondary bottlenecks

### Blend-state cloning is expensive during preset transitions

`cloneBlendState()` deep-copies wave positions, custom waves, shapes, borders, and motion vectors when blend transitions begin. This is not a per-frame cost, but it can cause visible spikes during preset switches, especially on dense presets.

### Renderer adapter cleanup patterns create avoidable array churn

The adapter frequently uses `group.children.slice(...)` and similar array-copy patterns while reconciling render groups. These are smaller costs than the VM allocations, but they still add pressure in a frame-critical path.

## Recommended order of attack

1. **Reduce per-frame allocations in `vm.ts` and `runtime.ts`.** This should produce the biggest frame-time improvement.
2. **Stop full overlay re-renders for browse/search/catalog changes.** This should improve responsiveness while the panel is open.
3. **Trim catalog refresh frequency.** This removes repeated UI work during editing and metadata tweaks.
4. **Simplify inspector updates.** This lowers diagnostic overhead without changing visuals.
5. **Optimize transition cloning and adapter reconciliation.** These are worthwhile once the bigger hotspots are addressed.

## Evidence reviewed

- `assets/js/milkdrop/runtime.ts`
- `assets/js/milkdrop/vm.ts`
- `assets/js/milkdrop/overlay.ts`
- `assets/js/milkdrop/renderer-adapter.ts`
- `assets/js/core/web-toy.ts`
