# Front-end inefficiencies and antipatterns (2026-03)

This audit identifies 10 concrete inefficiencies/antipatterns in the current front-end code.

1. **Repeated global DOM querying in hot paths**  
   `getSortLabel()` queries `[data-sort-control]` every call and `formatTokenLabel()` scans all chips on each token format operation, causing avoidable repeated traversal work during filtering/renders.  
   Evidence: `assets/js/library-view.js` lines 87-92 and 119-125.

2. **Full list teardown and rebuild on each render**  
   `renderToys()` clears `list.innerHTML` and reconstructs all cards each update. This discards existing nodes and event state and causes layout/repaint churn for every search/filter/sort interaction.  
   Evidence: `assets/js/library-view.js` lines 851-855 and 930-932.

3. **Card insertion without batching (`DocumentFragment`)**  
   Cards are appended one by one in a loop, which is less efficient than buffering into a fragment and appending once.  
   Evidence: `assets/js/library-view.js` line 931.

4. **Expensive full rerender on each keystroke**  
   Search input updates call `filterToys()` on each `input`, and `filterToys()` triggers `renderToys(applyFilters())`, causing full list regeneration while typing.  
   Evidence: `assets/js/library-view.js` lines 944-951 and 1063-1065.

5. **Many per-element listeners instead of delegated handling**  
   `initFilters()` attaches a separate click listener to every filter chip. With more chips, this scales listener count and setup cost unnecessarily versus delegated listeners.  
   Evidence: `assets/js/library-view.js` lines 1008-1012.

6. **Repeated full datalist rebuild**  
   `populateSearchSuggestions()` clears and rebuilds the datalist from scratch (`innerHTML = ''` + append loop), which is unnecessary if toy metadata is static during a session.  
   Evidence: `assets/js/library-view.js` lines 982-985 and 997-1004.

7. **Per-frame object allocation in animation loop**  
   Library ambient animation creates `new Color()` every frame (`backgroundScene.background = new Color().setHSL(...)`), which increases GC pressure over time.  
   Evidence: `assets/js/library-view/three-library-effects.ts` lines 62-63 and 71-75.

8. **Rendering every preview every frame regardless of visibility**  
   The animation loop iterates all preview renderers every frame and renders each one without viewport/intersection checks, wasting GPU/CPU for offscreen cards.  
   Evidence: `assets/js/library-view/three-library-effects.ts` lines 79-83.

9. **Event-listener lifecycle leak risk**  
   `createAmbientLayer()` adds a `resize` listener but `dispose()` does not remove it, so repeated init/dispose cycles can accumulate stale listeners.  
   Evidence: `assets/js/library-view/three-library-effects.ts` lines 135-143 and 233-245.

10. **Heavy per-instance cloning/allocation inside frame updates**  
    In `fractal-kite-garden` animation, each kite update clones vectors/colors and creates new `THREE.Color` instances during every frame, creating significant allocation overhead under high kite counts.  
    Evidence: `assets/js/toys/fractal-kite-garden.ts` lines 290-296 and 309-315.

## Suggested remediation order

1. Optimize `renderToys` update strategy (diffing or keyed patching + fragment batching).
2. Reduce per-frame allocations in `three-library-effects` and `fractal-kite-garden`.
3. Add visibility gating for preview renderer updates.
4. Consolidate chip listeners using event delegation.
5. Cache recurring DOM references and suggestion lists.
