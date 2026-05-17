# Renderer Setup Fallback State Machine Design

Sprint 7 planning phase — design document. No code changes produced.

---

## 1. Current Implicit Fallback Sequence

The setup path spans 12 files with no single state machine. Decisions are encoded as mid-function `return` branches, catch blocks, and silent downgrades. The diagram below traces the actual call graph.

### 1.1 State Diagram (As-Implemented)

```
                        ┌─────────────────────────────┐
                        │    entry: requestRenderer()   │
                        │    render-service.ts:495      │
                        └─────────────┬───────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────────┐
                        │  ensureWebGL()              │
                        │  webgl-check.ts:207         │
                        │  ┌─ hasGPU? ──▶ return true │
                        │  └─ no GPU? ──▶ overlay +   │
                        │                return false │
                        └─────────────┬───────────────┘
                                      │ (false → null return)
                                      │ (true continues)
                                      ▼
          ┌───────────────────────────────────────────────┐
          │  getRendererCapabilities()                     │
          │  renderer-capabilities.ts:674                  │
          │                                                │
          │  Check order (probeRendererCapabilities:488):  │
          │  ┌─ no navigator? ──▶ RENDERER_UNAVAILABLE    │
          │  ├─ compat mode?  ──▶ COMPATIBILITY_MODE       │
          │  ├─ guarded mobile?──▶ force WebGL             │
          │  ├─ gap-guard on?  ──▶ force WebGL             │
          │  ├─ no navigator.gpu?──▶ WEBGPU_UNAVAILABLE    │
          │  ├─ fallback adapter?──▶ FALLBACK_ADAPTER       │
          │  ├─ no adapter?    ──▶ NO_ADAPTER              │
          │  ├─ device timeout? ──▶ NO_DEVICE              │
          │  ├─ device null?   ──▶ fallback                │
          │  └─ success       ──▶ webgpu capabilities      │
          └───────────────────┬───────────────────────────┘
                              │
                              ▼
          ┌───────────────────────────────────────────────┐
          │  deriveRendererPlan()                          │
          │  renderer-plan.ts:19                           │
          │                                                │
          │  ┌─ caps null + hasWebGL? ──▶ webgl           │
          │  ├─ caps preferredBackend 'webgpu'? ──▶ webgpu│
          │  ├─ caps preferredBackend null? ──▶ null      │
          │  └─ else                   ──▶ webgl          │
          └───────────────────┬───────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
              plan=webgpu          plan=webgl/null
                    │                    │
                    ▼                    ▼
    ┌────────────────────────────┐  ┌──────────────────┐
    │ Try WebGPU device request  │  │ fallbackToWebGL()│
    │ (renderer-setup.ts:185)    │  │ (line 253)       │
    │  ├─ timeout? ──▶ WebGL    │  └──────────────────┘
    │  ├─ null?    ──▶ WebGL    │
    │  ├─ create WebGPURenderer  │
    │  │  ├─ init timeout? ──▶ WG│
    │  │  └─ success → finalize │
    │  └─ catch   ──▶ WebGL     │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │ finalize()                 │
    │ renderer-setup.ts:106      │
    │ (sets pixel ratio,         │
    │  tone mapping, etc.)       │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────────────┐
    │ createRendererHandle()             │
    │ render-service.ts:270              │
    │ ┌─ WebGPU → createWebGpuFacade()  │
    │ │   (proxies setAnimationLoop,     │
    │ │    device loss recovery)         │
    │ ├─ observeWebGpuDevice()           │
    │ └─ pool + return handle           │
    └────────────────┬───────────────────┘
                     │
                     │ (later, separately)
                     ▼
    ┌────────────────────────────────────┐
    │ initAudio()                        │
    │ audio-handler.ts:547               │
    │ ┌─ AudioListener create           │
    │ ├─ query permission state          │
    │ ├─ getUserMedia()                  │
    │ └─ FrequencyAnalyser.create()      │
    │    ├─ AudioWorklet? → yes          │
    │    └─ fails? → AnalyserNode        │
    └────────────────────────────────────┘
```

### 1.2 Ownership Map

| File | Responsible for |
|------|----------------|
| `webgl-check.ts` | Gate: can we render at all? |
| `renderer-capabilities.ts` | Probe: what backends exist? (9 return paths) |
| `renderer-plan.ts` | Decide: which backend? (4 return paths) |
| `renderer-setup.ts` | Execute: init chosen backend, fallback on failure (6 return paths) |
| `render-service.ts` | Manage: pool, device loss recovery, WebGPU animation facade |
| `renderer-settings.ts` | Propagate: renderScale via multi-hop chain |
| `audio-handler.ts` | Init: microphone, AudioWorklet→AnalyserNode fallback |
| `audio-service.ts` | Pool: stream reuse, cleanup |
| `backend-fallback.ts` | Runtime: preset-level WebGPU→WebGL fallback |

---

## 2. Explicit State Machine Design

### 2.1 States

| State | Meaning |
|-------|---------|
| `initial` | Entry point, no work done |
| `probing-webgpu` | `navigator.gpu.requestAdapter()` in flight |
| `probing-webgl` | Checking `webgl` canvas context availability |
| `renderer-ready` | A renderer (WebGL or WebGPU) is initialized and active |
| `renderer-timeout` | Renderer init timed out, cleanup in progress |
| `renderer-degraded` | WebGPU failed mid-operation, WebGL is the active renderer |
| `pooling-renderer` | Renderer is held in the service pool, waiting for reuse |
| `audio-initializing` | `getUserMedia` + `AudioWorklet`/`AnalyserNode` in flight |
| `audio-ready` | Audio pipeline is active (worklet or AnalyserNode) |
| `ready` | Both renderer and audio are operational |
| `error-no-backend` | No GPU backend available (ensureWebGL returned false) |
| `error-no-audio` | Audio capture failed (user denied or unsupported) |

### 2.2 Transition Table

Every transition is `<from-state> → <to-state>` triggered by `<event/condition>`.

| # | From | To | Trigger | Owner |
|---|------|----|---------|-------|
| 1 | `initial` | `probing-webgl` | `ensureWebGL()` called | `webgl-check.ts` |
| 2 | `initial` | `error-no-backend` | `ensureWebGL()` returns false (no WebGL/WebGPU support) | `webgl-check.ts` |
| 3 | `probing-webgl` | `probing-webgpu` | WebGL confirmed, `getRendererCapabilities()` called | `renderer-capabilities.ts` |
| 4 | `probing-webgl` | `error-no-backend` | WebGL probe fails | `webgl-check.ts` → `renderer-capabilities.ts` |
| 5 | `probing-webgpu` | `renderer-ready` | Capabilities + plan confirmed, renderer created successfully | `renderer-setup.ts` |
| 6 | `probing-webgpu` | `renderer-ready` | WebGPU unavailable → `fallbackToWebGL()` succeeds | `renderer-setup.ts:253` |
| 7 | `probing-webgpu` | `renderer-timeout` | `resolveWithTimeout()` rejects (WebGPU device or init timeout) | `renderer-setup.ts:186,226` |
| 8 | `probing-webgpu` | `error-no-backend` | WebGL fallback also fails | `renderer-setup.ts:253` → `initRenderer` returns null |
| 9 | `renderer-timeout` | `renderer-ready` | Timeout handled, `fallbackToWebGL()` creates WebGL renderer | `renderer-setup.ts:234,244` |
| 10 | `renderer-timeout` | `error-no-backend` | Timeout cleanup done, WebGL creation also fails | `renderer-setup.ts` |
| 11 | `renderer-ready` | `renderer-degraded` | WebGPU device lost or uncaptured error → recovery fails, switches backend | `render-service.ts:348-368` |
| 12 | `renderer-ready` | `renderer-ready` | WebGPU device lost → recovery succeeds (keeps WebGPU) | `render-service.ts:298-346` |
| 13 | `renderer-ready` | `pooling-renderer` | `rendererHandle.release()` called, not disposed | `render-service.ts:525-531` |
| 14 | `pooling-renderer` | `renderer-ready` | `requestRenderer()` reuses pooled entry | `render-service.ts:506-513` |
| 15 | `renderer-ready` | `initial` | Pool reset with `dispose: true` | `render-service.ts:576-596` |
| 16 | `renderer-ready` | `audio-initializing` | `initAudio()` / `acquireAudioHandle()` called | `audio-handler.ts:547` / `audio-service.ts:60` |
| 17 | `pooling-renderer` | `audio-initializing` | Audio init requested while renderer is pooled | `toy-audio-session.ts:16` |
| 18 | `audio-initializing` | `audio-ready` | `FrequencyAnalyser.create()` succeeds (worklet or AnalyserNode) | `audio-handler.ts:628` |
| 19 | `audio-initializing` | `error-no-audio` | `getUserMedia` denied, unsupported, or unavailable | `audio-handler.ts:694-731` |
| 20 | `audio-ready` | `error-no-audio` | Audio device disconnected at runtime, context closed | (runtime event, not currently handled) |
| 21 | `audio-ready` | `renderer-degraded` | Mid-session backend fallback (device loss) while audio is active | `render-service.ts` + `backend-fallback.ts` |
| 22 | `audio-ready` | `audio-ready` | Audio context resumed after user gesture | `audio-handler.ts:585` |
| 23 | `renderer-degraded` | `renderer-ready` | Compatibility mode cleared, WebGPU re-probed successfully | (not implemented — user must refresh) |
| 24 | `audio-ready` | `ready` | Both renderer and audio confirmed operational | `animation-loop.ts:65-85` |
| 25 | `error-no-audio` | `renderer-ready` | Audio error acknowledged, synthetic/demo audio used instead | (caller decides — `animation-loop.ts:93-96`) |
| 26 | `error-no-audio` | `ready` | Fallback to `createSyntheticAudioStream` or `getCachedDemoAudioStream` succeeds | `animation-loop.ts` caller path |
| 27 | `renderer-degraded` | `pooling-renderer` | Degraded renderer released to pool | `render-service.ts:525` |
| 28 | `renderer-degraded` | `renderer-degraded` | Milkdrop preset triggers `backend-fallback.ts:trigger()` — sets compatibility mode, reloads | `backend-fallback.ts:40-56` |

### 2.3 Invalid Transitions

The following paths must never occur in the explicit machine:

| Path | Why invalid |
|------|-------------|
| `initial` → `audio-initializing` | Audio requires a renderer for the Three.js `AudioListener`. The `initAudio` function creates `new AudioListener()` independently, so this is technically reachable today but wrong — it means audio can start without knowing the renderer backend. |
| `probing-webgpu` → `audio-initializing` | Audio must not begin before the backend is resolved. The `FrequencyAnalyser` has no dependency on the renderer, but the animation loop (`startAudioLoop` in `animation-loop.ts:70-72`) explicitly awaits `rendererReady` before calling `initAudio`. |
| `renderer-ready` → `audio-ready` (skipping `audio-initializing`) | Audio setup is async; there is no synchronous path from no-audio to audio-ready. |
| `error-no-backend` → `renderer-ready` | Once no backend is available, only a page reload can re-probe. No in-session recovery path exists. |
| `renderer-degraded` → `probing-webgpu` | The degraded state is terminal for the session; `setCompatibilityMode(true)` persists to localStorage, blocking WebGPU re-probe on the same session. |
| `renderer-timeout` → `renderer-timeout` | A timeout can only resolve to a fallback or failure. Self-loop is meaningless. |

---

## 3. Current Problems

### 3.1 Implicit Ordering ("Must Call X Before Y" Without Checks)

| # | Requirement | Where enforced | Risk |
|---|-------------|---------------|------|
| P1 | `ensureWebGL()` must be called before any renderer init | `renderer-setup.ts:89-91` — hardcoded as first line of `initRenderer`. | If `ensureWebGL` is bypassed (e.g., worker path), no GPU check runs. The worker path (`renderer-worker.ts:289`) has its own `initRenderer` that doesn't call `ensureWebGL`. |
| P2 | `getRendererCapabilities()` must resolve before `deriveRendererPlan()` | `renderer-setup.ts:169-175` — sequential `await` in same function. | No typing constraint; the plan depends on capabilities but nothing prevents calling `deriveRendererPlan` with stale/null caps. |
| P3 | `plan.backend === 'webgpu'` must be checked before attempting `WebGPURenderer` construction | `renderer-setup.ts:180` — inline `if` guard. | If someone calls `initRenderer` with a plan that says `'webgpu'` but no adapter, the code skips WebGPU and falls through to WebGL. The check is in one function; no protocol enforcement. |
| P4 | `initAudio()` assumes no backend dependency but `startAudioLoop()` requires `toy.rendererReady` first | `animation-loop.ts:70-72` — `await toy.rendererReady` before `toy.initAudio`. | If `initAudio` is called directly (bypassing `startAudioLoop`), audio starts without renderer awareness. The `FrequencyAnalyser.create()` has no check for whether a renderer exists. |
| P5 | Audio worklet assumes `AudioContext` is already running | `audio-handler.ts:196-233` — no check on `context.state` before `addModule`. | If context is suspended, AudioWorklet registration may fail silently on some browsers. The `resume()` call happens at line 585 but only inside the outer try block. |
| P6 | `renderScale` propagation depends on 4-layer chain: `options` → `defaults` → `info` → `BASE_RENDERER_SETTINGS` | `renderer-settings.ts:127-177` — each fallback level is unwritten convention. | No type-level distinction between "user-provided scale" and "default-computed scale". Any layer can accidentally override the wrong value. |

### 3.2 renderScale Multi-Hop Without Typing

The `renderScale` value traverses:

```
initRenderer config → getRenderDefaults() → resolveRendererSettings() → applyRendererSettings()
                                                             ↓
                                              RendererInitResult info.renderScale (mutated in-place at line 219)
```

- `initRenderer` accepts `renderScale` in `RendererInitConfig` and stores it in `RendererInitResult.renderScale`
- `render-service.ts:getRenderDefaults()` composes `renderScale = activeRuntimeControls.renderScale * (preferences.renderScale ?? quality.renderScale ?? 1)`
- `resolveRendererSettings` has a 4-level fallback for every field (`options` → `defaults` → `info` → `BASE_RENDERER_SETTINGS`)
- `applyRendererSettings` recomputes pixel ratio and mutates `info.renderScale` in-place

No type distinguishes `RenderScaleUser` from `RenderScaleComputed` from `RenderScaleEffective`. If `activeRuntimeControls.renderScale` is changed after init, the scale must be re-composed through the same multi-hop chain — there's no memoization and no invalidation.

### 3.3 Timeout Cleanup Gaps

| Location | Issue |
|----------|-------|
| `renderer-setup.ts:233` | `void initPromise.then(disposeTimedOutRenderer).catch(() => {})` — fire-and-forget cleanup. If the user navigates away between the timeout throwing and this `.then()` resolving, `disposeTimedOutRenderer` may run on a disposed canvas. The `rendererDisposed` flag guards against double-dispose but not against use-after-dispose. |
| `renderer-init-timeout.ts:22` | The `finally` block clears the timeout, but if `Promise.race` rejects AND the underlying promise later resolves, the resolved value is silently discarded. No `AbortController` pattern — the timed-out promise keeps running. |
| `render-service.ts:349-367` | `webGpuRecovery` is a module-level promise that gates duplicate recovery attempts. If recovery fails and the promise is cleared (`webGpuRecovery = null`), a subsequent device loss event will re-trigger recovery — but the underlying device may still be in a bad state. No backoff or max-retry counter. |

### 3.4 Audio Worklet Assumes Backend Already Chosen

`FrequencyAnalyser.create()` (`audio-handler.ts:186-255`) runs independently of the renderer backend:

- It creates its own `AudioContext` (via the `AudioListener`) — no coupling to WebGL vs WebGPU
- If the worklet fails, it silently falls back to `AnalyserNode` (line 229: `console.warn`)
- The caller (`initAudio`) has no awareness of whether the worklet succeeded or the AnalyserNode fallback was used
- The `FrequencyAnalyser` class stores either `workletNode` or `analyserNode` but exposes no property to query which path was taken

This means audio quality silently degrades with no telemetry and no recovery path. If the worklet fails transiently (e.g., context not yet resumed), the permanent fallback to `AnalyserNode` is irreversible for the session.

---

## 4. Proposed File Changes (Implementation Plan, Not Code)

The changes below are ordered by dependency; each builds on the previous.

### Phase 1: State Machine Foundation

| Order | File | Change |
|-------|------|--------|
| 1 | `assets/js/core/renderer-fsm.ts` (NEW) | Define the explicit state machine: `RendererSetupState` enum, `RendererSetupEvent` discriminated union, `transition(state, event): RendererSetupState` pure function. Include all states and transitions from §2.2. |
| 2 | `assets/js/core/renderer-fsm.test.ts` (NEW) | Test every valid transition and assert every invalid transition throws. |
| 3 | `assets/js/core/renderer-setup.ts` | Replace the inline fallback branches with calls to the FSM. `initRenderer` becomes a state-machine executor: poll current state, dispatch events, react to next state. |
| 4 | `assets/js/core/renderer-capabilities.ts` | Extract the `probeRendererCapabilities` 9-return-path cascade into a `probeCapabilityTier()` function that returns an event (`AdapterFound`, `AdapterFallback`, `DeviceTimeout`, etc.) rather than a complex result object. |

### Phase 2: renderScale Typing

| Order | File | Change |
|-------|------|--------|
| 5 | `assets/js/core/renderer-settings.ts` | Add `RenderScaleUser` (input), `RenderScaleComputed` (after multiplier chain), and `RenderScaleEffective` (final pixel ratio) branded types. Split `resolveRendererSettings` into `resolveUserScale` and `computeEffectiveScale` — separate concerns. |
| 6 | `assets/js/core/renderer-setup.ts` | Accept typed `RenderScaleUser` in `RendererInitConfig`, produce typed `RenderScaleEffective` in `RendererInitResult`. Remove in-place mutation of `info.renderScale` from `applyRendererSettings`. |
| 7 | `assets/js/core/services/render-service.ts` | Update `getRenderDefaults()` to use typed scale composition. |

### Phase 3: Timeout & Cleanup Hardening

| Order | File | Change |
|-------|------|--------|
| 8 | `assets/js/core/renderer-init-timeout.ts` | Add `AbortController` support. Return a `{ result, didTimeout }` wrapper instead of racing and discarding. |
| 9 | `assets/js/core/renderer-setup.ts` | Replace fire-and-forget `void initPromise.then(disposeTimedOutRenderer)` with a cancellable cleanup token. Track the init promise's lifecycle through the FSM. |
| 10 | `assets/js/core/services/render-service.ts` | Add retry backoff with max attempts for `queueWebGpuRecovery`. Track recovery attempts in the FSM state. |

### Phase 4: Audio-Renderer Coupling

| Order | File | Change |
|-------|------|--------|
| 11 | `assets/js/core/audio-handler.ts` | Add `AudioPipelineMode` enum (`worklet` | `analyser-node`). Expose on `FrequencyAnalyser`. Add `AudioInitEvent` union for FSM integration. |
| 12 | `assets/js/core/animation-loop.ts` | Guard `initAudio` call with FSM state check: only proceed if state is `renderer-ready` or `renderer-degraded`. |
| 13 | `assets/js/core/renderer-fsm.ts` | Expand FSM to include audio states and cross-cutting transitions (audio failure while rendering, device loss during audio playback). |

### Files NOT Changed

| File | Reason |
|------|--------|
| `webgl-check.ts` | Already a well-isolated gate function. Expose its result as an FSM event; no internal restructuring needed. |
| `renderer-plan.ts` | Superseded by the FSM. The plan becomes a computed property of the current state rather than a separate function. |
| `renderer-fallback-reasons.ts` | Stable enum; consumed by FSM event payloads. |
| `renderer-query-override.ts` | Stable override logic; consumed as FSM guard conditions. |
| `backend-fallback.ts` (milkdrop) | Runtime preset-level fallback is orthogonal to the setup FSM. Wired as an event source into the FSM's `renderer-degraded` transition. |
| `device-profile.ts` | Read-only utility; stable. |

---

## 5. Summary

### State Diagram Summary

```
                   ┌─────────┐
                   │ initial │
                   └────┬────┘
                        │ ensureWebGL()
                   ┌────┴────┐
              true │         │ false
                   ▼         ▼
         ┌──────────────┐  ┌─────────────────┐
    ┌───▶│probing-webgpu│  │ error-no-backend │
    │    └──────┬───────┘  └─────────────────┘
    │           │ adapter found / fallback
    │    ┌──────┴───────┐
    │    │renderer-ready│◀──────────── timeout handled
    │    └──┬───┬───┬───┘
    │       │   │   │ device lost (recoverable)
    │       │   │   └──────────────────────────┐
    │       │   │ device lost (unrecoverable)  │
    │       │   ▼                              ▼
    │       │ ┌──────────────────┐  ┌──────────────────┐
    │       │ │renderer-degraded │  │pooling-renderer  │
    │       │ └────────┬─────────┘  └────────┬─────────┘
    │       │          │                     │
    │       │          │                     │ requestRenderer reuse
    │       │          │                     ▼
    │       │          │           ┌──────────────────┐
    │       │          │           │  renderer-ready  │ (re-entry)
    │       │          │           └──────────────────┘
    │       │          │
    │       │    ┌─────┴──────┐
    │       │    │audio-init  │
    │       │    └─────┬──────┘
    │       │     ┌────┴────┐
    │       │  ok │         │ error
    │       │     ▼         ▼
    │       │ ┌──────────┐ ┌──────────────┐
    │       │ │audio-ready│ │error-no-audio│
    │       │ └─────┬─────┘ └──────┬───────┘
    │       │       │              │ synthetic fallback
    │       │       └──────┬───────┘
    │       │              ▼
    │       │        ┌───────┐
    │       └───────▶│ ready │
    │                └───────┘
    │
    └── compatibility mode cleared (currently requires refresh)
```

### Implicit Ordering Risks Found: **6**

P1-P6 listed in §3.1 above.

### Files With Most Fragile Chains

1. **`renderer-setup.ts`** (6 return paths, 2 distinct timeout sites, 1 fire-and-forget cleanup) — highest fragility
2. **`renderer-capabilities.ts`** (9 return paths in `probeRendererCapabilities`, device loss observer with unguarded async mutation of `cachedCapabilities`)
3. **`render-service.ts`** (WebGPU recovery with no retry limit, animation loop proxy that can silently fail, in-place mutation of `initResult` during settings apply)
4. **`audio-handler.ts`** (silent worklet→AnalyserNode fallback with no telemetry, `FrequencyAnalyser` doesn't expose which pipeline path is active)

### Transition Table (Text Form)

See §2.2 above — 28 transitions across 12 states, with 6 explicitly invalid transitions documented in §2.3.
