# Stims Ideal End-State UI: Working Backwards Plan

## The Ideal End State (written as if it exists)

You open toil.fyi. Before you can think, the screen fills with motion — waveforms,
particle fields, geometric forms — responding to... nothing yet. A soft glow pulses
in the corner: "Tap to feel your music." You tap. The visual world shifts, locks
to your mic input. You swipe left, the visuals warp. You swipe right, a new world.

There are no buttons. No panels. No docks. The interface IS the visualizer.

Move your mouse, and controls bloom from the edges — translucent, pulsing with the
beat. Stop moving, they dissolve back into the visual after 3 seconds.

You want a specific look. You don't search — you describe: "synthwave sunset."
The AI understands and shifts the preset. You like this one. A two-finger tap saves
it. Later, you three-finger-swipe to browse your saved looks as visual thumbnails
that float and breathe.

On your phone, the same. The gestures are touch-native. On your TV, it runs
fullscreen with a companion phone-as-remote. On your laptop, keyboard shortcuts
and precision mouse control.

The visualizer never stops. Never reloads. UI elements never clip or jank.
Transitions are a continuous morph — nothing blinks, nothing jars.

---

## Layer 1: UX Principles (the "why")

Every concrete decision traces to one of these:

1. **Stage is canvas is interface.** The visualizer is never obscured, shrunk, or
   paused for UI. All controls are rendered ON the stage (as overlays) or as
   translucent sheets that let the visual bleed through.
2. **Zero persistent chrome.** No toolbar, no dock, no status bar. Every UI
   element appears on-demand and fades after inactivity (desktop: mouse-move
   summon; mobile: tap-summon).
3. **Gesture uniformity.** Desktop keyboard and mobile touch expose the same
   actions via different modalities. No "mobile mode" vs "desktop mode" — one
   adaptive shell.
4. **No modal breaks.** Panels are always dismissable by interacting with the
   stage behind them. No confirm/cancel dialogs (undo handles that).
5. **Response is visual.** Feedback is delivered through the visualizer —
   confirmations ripple, errors flash, transitions morph. Toast text is last
   resort.

---

## Layer 2: Interaction Model (the "how")

Working backwards from principles to concrete interactions:

### Desktop
| Gesture | Action |
|---------|--------|
| Move mouse | Summon control layer (3s fade-after-stop) |
| Scroll up/down | Browse preset list (overlaid on stage edge) |
| `E` | Toggle editor (translucent sheet, RHS) |
| `B` | Toggle browse (bottom sheet, visual bleeds through) |
| `S` | Toggle settings (thin LHS panel) |
| Arrow L/R | Previous/next preset |
| `Space` | Play/pause audio |
| `F` | Fullscreen |
| Click-drag on stage | Direct parameter manipulation (warp, zoom, rotate) |

### Mobile
| Gesture | Action |
|---------|--------|
| Tap | Summon/auto-hide controls |
| Swipe up from bottom | Browse sheet (50% height, visual bleeds) |
| Swipe down | Dismiss any open sheet |
| Swipe L/R on stage | Previous/next preset (with crossfade) |
| Long press | Quick-action radial menu |
| Two-finger tap | Save current look |
| Three-finger swipe | Browse saved presets |
| Pinch | Zoom into visual detail |

### Universal
| Action | Feedback |
|--------|----------|
| Preset change | Visual morph transition (no cut) |
| Save | Brief ripple from save point |
| Error | Red flash at edge, then fade |
| AI generation | Visual blooms from center as it loads |

---

## Layer 3: Component Architecture (the "what")

Working backwards from interactions to components:

```
Viewport (100vw x 100vh)
├── StageElement (<canvas>)
│   ├── occupies full viewport always
│   └── is the background for everything
│
├── ControlLayer (ephemeral, mouse-move summon)
│   ├── AutoHideTimer (3s no-activity → fade out)
│   ├── TopEdgeControls (audio source indicator + now-playing)
│   │   └── AudioSourceIndicator (live waveform + source label)
│   ├── BottomEdgeControls (playback: prev/play/next/shuffle/fullscreen)
│   ├── LeftEdge (settings gear)
│   ├── RightEdge (editor / more menu)
│   └── CenterOverlay (contextual: "Swipe to change", "Press E to edit")
│
├── BrowseSheet (from bottom edge, 40-80% height)
│   ├── translucent backdrop (visual bleeds through, blurred)
│   ├── SheetHandle (drag to resize/dismiss)
│   ├── SearchBar (inline, filters as you type)
│   ├── PresetCarousel (horizontal scroll of cards)
│   │   ├── each card shows live preview thumbnail
│   │   └── cards animate based on scroll position (parallax)
│   └── CollectionPills (tags, horizontal scroll)
│
├── EditorSheet (from right edge, 45% width)
│   ├── translucent, stage visible behind
│   ├── CodeMirror 6 with MilkDrop syntax
│   ├── ParameterSliders (collapsible sidebar)
│   └── AI assistant (inline, not modal)
│
├── SettingsSheet (from left edge, 35% width)
│   ├── translucent, stage visible behind
│   └── grouped settings (performance, audio, display)
│
├── MobileBottomControls (touch-optimized, only on narrow viewports)
│   └── condensed: prev/play/next + browse/edit/settings + energy meter
│
└── ToastLayer (transient messages)
    └── morphs into stage effect when possible
```

Key architectural decisions:

- **Single shell** — `App.tsx` shrinks from 717 lines to ~100. It lays out
  `StageElement` + `ControlLayer` + active sheet. No mobile/desktop branches.
- **Sheet is one component** — `BottomSheet.tsx` generalizes to handle bottom,
  left, right positions. No separate `WorkspaceToolSheet`, `SplitViewBrowse`,
  `MobileControlBar` as sibling components.
- **ControlLayer isolates auto-hide** — a single `useAutoHide(delay)` hook
  controls all ephemeral UI. Currently, `MobileControlBar` has its own 4s timer
  and `StimsControlDock` has none. Unified.
- **Stage is always full-viewport** — sheets overlay with `mix-blend-mode` or
  `backdrop-filter`. Currently, `WorkspaceToolSheet` competes for space with
  `StimsStageFrame`, sometimes shrinking the stage.

---

## Layer 4: State Architecture (the "data")

Working backwards from components to state:

```
WorkspaceState (single source of truth, URL-serializable)
├── route: SessionRouteState (panel, presetId, audioSource, ...)
│   └── persisted in URL search params, single source for panel state
├── sheets: Map<PanelState, SheetState>
│   ├── open: boolean
│   ├── size: number (0-1, drag-resizable)
│   ├── position: 'bottom' | 'left' | 'right'
│   └── history: PanelState[] (for back gesture)
├── controlLayer: { visible: boolean, lastActivity: timestamp }
├── audio: AudioState (source, energy, waveform data)
├── editor: EditorState (dirty, undo stack, cursor position)
└── toast: ToastState | null

EngineSnapshot (per-frame, immutable, same ref means no change)
├── activePresetId: string | null
├── audioEnergy: { bass, mid, treble, volume }
├── renderState: { fps, resolution, backend }
└── presetLoading: boolean
```

Key decisions:

- **URL is the truth** — `SessionRouteState` serializes to/from URL. Shared
  links restore exact UI state (which panel open, which preset, which audio).
  Currently, only `presetId`, `collectionTag`, `panel`, and `audioSource` survive
  a reload.
- **Sheet state is first-class** — currently `PanelState` is a simple union
  (`'browse' | 'editor' | 'inspector' | 'settings' | null`). In the ideal,
  each panel has size, history, animation state. Enables swipe-back, drag-resize.
- **No React Context for transient state** — `EngineSnapshot` uses refs + atomic
  update signaling. Currently it uses `EngineSnapshotCtx` which re-renders the
  entire tree on every frame. In the ideal, only subscribers to specific snapshot
  keys re-render.

---

## Layer 5: Infrastructure (the "patterns")

Working backwards from state to patterns:

1. **URL state via `useSearchParams` (React Router or native)** — replace custom
   `url-state.ts` (253 lines of manual serialization) with standard library.
   Eliminates the `commitRoute`/`setRouteState` split — route changes ARE state
   changes, not mediated through a context wrapper.

2. **Sheet manager reducer** — a single `useReducer` (or Zustand store) drives
   all sheet animations, position, history. Currently, open/close logic is
   scattered across `WorkspaceToolSheet`, `BottomSheet`, `MobileControlBar`,
   and `SplitViewBrowse`.

3. **`useAutoHideActivity` hook** — returns `{ visible, signalActivity }`.
   `ControlLayer` subscribes. Stage mouse-move/touch calls `signalActivity`.
   Single timer, no duplicate `setTimeout`s.

4. **`useStageGesture` hook** — normalizes touch/mouse/keyboard into semantic
   events (`NEXT_PRESET`, `OPEN_BROWSE`, `SAVE_PRESET`). Decouples input modality
   from action handling.

5. **`useAnimationFrame` subscription pattern** — components subscribe to
   specific `EngineSnapshot` keys. Instead of `<EngineSnapshotCtx>` re-rendering
   everything at 60fps, individual components read snapshot refs and
   `requestAnimationFrame` independently.

6. **CSS view transitions API** — `@view-transition` for preset changes,
   panel open/close. Replaces custom animation classes.

---

## Gap Analysis: Current → Ideal

| Dimension | Current | Ideal | Gap |
|-----------|---------|-------|-----|
| **Stage priority** | Stage shrinks when panel open | Stage always full-viewport | Panels need `backdrop-filter` overlay mode |
| **Chrome persistence** | Toolbar always visible (StimsControlDock) | All UI ephemeral | Need auto-hide + gesture summon for ALL controls, including audio meter |
| **Mobile/Desktop split** | Two code paths (MobileControlBar vs StimsControlDock) | Single adaptive shell | Unify into one responsive component |
| **Sheet system** | 4+ distinct sheet components with separate logic | One `<Sheet>` component with position/size props | Generalize `BottomSheet.tsx` |
| **App.tsx surface** | 717-line monolith | ~100-line layout shell | Extract keyboard shortcuts, fullscreen, theme, contextual help, mobile bar into dedicated hooks/components |
| **URL state** | Custom `url-state.ts` (253 lines) | Standard `useSearchParams` | Replace custom code unless Vite-specific constraints prevent it |
| **Per-frame updates** | `EngineSnapshotCtx` re-renders entire tree | Per-key subscription | Implement ref-based snapshot with selective subscription |
| **Animation** | CSS classes toggled | CSS view transitions + gesture-driven | Add view-transition API, deprecate manual class swapping |
| **Gesture system** | Ad-hoc `onTouchStart`/`onMouseDown` handlers | Unified `useStageGesture` | Build gesture normalization layer |
| **Undo/redo** | None (editor has undo via CodeMirror) | System-wide undo (save, delete, edit) | Add global `UndoStack` |

---

## Roadmap: Phased Implementation

### Phase 1: Sheet Unification (low risk, high impact)
1. Generalize `BottomSheet.tsx` to accept `position` prop (`bottom|left|right`)
2. Replace `WorkspaceToolSheet` → use `<Sheet position="bottom">`
3. Replace `SplitViewBrowse` → use `<Sheet position="right" size={0.55}>`
4. Remove `splitView-mode` media query, make sheet behavior responsive
5. Add `backdrop-filter: blur()` to sheet body → stage visible behind
6. Delete `StimsStageFrame` space-sharing logic → stage is always 100vw×100vh

### Phase 2: Ephemeral Controls (medium risk, high impact)
1. Build `useAutoHideActivity(delayMs)` hook
2. Build `ControlLayer` component wrapping current controls
3. Migrate `StimsControlDock` into `ControlLayer.BottomEdge`
4. Add edge triggers for left/right/top quadrants
5. Move `MobileControlBar` behavior into same component (responsive breakpoint)
6. Extract "now playing" bar into `ControlLayer.TopEdge`

### Phase 3: App Shell Decomposition (high risk, high impact)
1. Extract keyboard shortcuts into `useKeyboardShortcuts` hook
2. Extract fullscreen into `useFullscreen` hook
3. Extract theme into `useTheme` hook
4. Extract audio match chip into `AudioMatchToast` component
5. Extract contextual help into `ContextualHelp` (already done, wire properly)
6. Move all toasts into `ToastLayer`
7. `App.tsx` becomes: `<Stage> <ControlLayer> <Sheet> <ToastLayer> </Stage>`

### Phase 4: Gesture Normalization (medium risk, medium impact)
1. Build `useStageGesture()` hook normalizing touch/mouse/keyboard
2. Define semantic event types (`NEXT`, `PREV`, `OPEN_BROWSE`, `SAVE`, etc.)
3. Wire `ControlLayer` and `Sheet` to consume semantic events
4. Remove ad-hoc handlers from individual components

### Phase 5: Per-Frame Rendering Optimization (high risk, medium impact)
1. Replace `EngineSnapshotCtx` with ref-based store
2. Add `subscribeToSnapshotKey(key, callback)` API
3. Migrate consumers (audio meter, energy display) to selective subscription
4. Measure: reduce React commit cycles from 60fps to 1-5fps for non-visual UI

### Phase 6: View Transitions + Polish (low risk, high polish)
1. Add `@view-transition` to preset change animation
2. Add `@view-transition` to sheet open/close
3. Make all transitions continuous (morph, not cut)
4. Add audio-reactive pulse to control layer elements
5. Polish: parallax in browse carousel, ripple on save, bloom on AI generate
