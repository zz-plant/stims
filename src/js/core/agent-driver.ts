/**
 * A single, versioned control surface for driving Stims from outside the
 * page — headless capture scripts, perf sweeps, MCP sessions. Installed at
 * `window.stims.agent` only in agent mode (`?agent=true`).
 *
 * This exists because the alternative — reaching into whichever ad hoc
 * global happened to be exposed for a different purpose
 * (`__STIMS_AGENT_RENDER_FRAMES__`, `__STIMS_AGENT_TELEMETRY__`,
 * `__stims_telemetry`, `__milkdropRuntimeDebug`, the `postMessage` bridge)
 * — means every driver reimplements the same readiness polling and
 * preset-applied detection, with its own bugs. `selectPreset` in particular
 * calls straight through to the navigation controller, skipping the
 * route/URL layer (and its own retry/fallback machinery) entirely — that
 * layer exists for human navigation, not automation.
 */
import type { MilkdropAgentDriverHandle } from '../milkdrop/runtime/debug-snapshot.ts';
import { isAgentMode } from './url-params.ts';

type StimsAppGlobals = typeof globalThis & {
  __stimsAppReady?: Promise<void>;
  __stimsStarterCatalogPromise?: Promise<unknown>;
  __milkdropRuntimeDebug?: MilkdropAgentDriverHandle;
};

type StimsGlobalNamespace = typeof globalThis & {
  stims?: { agent?: StimsAgentDriver };
};

export type AgentPresetResult = {
  requestedPresetId: string;
  /** Whatever the runtime settled on — differs from requestedPresetId on a
   * bad id, a compile failure, or a request superseded by a later one. */
  activePresetId: string | null;
  applied: boolean;
  elapsedMs: number;
};

export type AgentState = {
  presetId: string | null;
  backend: 'webgl' | 'webgpu' | null;
  status: string | null;
  /** From the performance tracker's rolling average — the same number the
   * renderer's own adaptive-quality controller acts on. Prefer this over
   * telemetry's fps field, which is a slower-moving EMA that can read stale
   * for seconds after a real change. */
  frameMs: number | null;
  fps: number | null;
  qualityStep: number | null;
  qualityStepCount: number | null;
  thermalState: string | null;
  sampleCount: number | null;
};

export type StimsAgentDriver = {
  readonly version: 1;
  /** Resolves once the app shell has mounted, the starter catalog has
   * loaded, and the milkdrop runtime driver handle is registered. Call this
   * before anything else — every other method assumes it. */
  ready(options?: { timeoutMs?: number }): Promise<void>;
  /** Selects a preset directly, bypassing route/URL state. Never rejects on
   * a failed load (bad id, compile error, superseded request) — check
   * `applied` and `activePresetId` on the result instead. Rejects only on
   * timeout. */
  selectPreset(
    presetId: string,
    options?: { timeoutMs?: number },
  ): Promise<AgentPresetResult>;
  /** A snapshot of the authoritative runtime state — not a cached/stale
   * telemetry read. */
  state(): AgentState;
  setAutoplay(enabled: boolean): void;
  /**
   * Best-effort settle heuristic: waits for at least `minFrames` rendered
   * frames since the call, then for the rolling average frame cost to stop
   * moving by more than ~1.5ms for `quietMs`. This is NOT a guarantee that
   * every async GPU pipeline warm-up has finished (see
   * feedback-manager-webgpu-tsl.ts's compileAsync warm-up) — it is a
   * measured proxy that is far more honest than a fixed sleep. Resolves
   * (does not reject) if `timeoutMs` elapses before stability is reached.
   */
  waitForSettled(options?: {
    minFrames?: number;
    quietMs?: number;
    timeoutMs?: number;
  }): Promise<void>;
};

declare global {
  interface Window {
    /** Agent-mode driver facade — see {@link StimsAgentDriver}. Undefined
     * outside agent mode or before `installAgentDriver()` has run. */
    stims?: { agent?: StimsAgentDriver };
  }
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const DEFAULT_SELECT_TIMEOUT_MS = 20_000;
const DEFAULT_SETTLE_TIMEOUT_MS = 8_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getGlobals(): StimsAppGlobals {
  return globalThis as StimsAppGlobals;
}

async function waitForDriverHandle(
  timeoutMs: number,
): Promise<MilkdropAgentDriverHandle> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = getGlobals().__milkdropRuntimeDebug;
    if (handle) {
      return handle;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'stims.agent: the milkdrop runtime driver handle never registered ' +
          '(the runtime may not have mounted, or agent mode is off).',
      );
    }
    await sleep(100);
  }
}

function readState(): AgentState {
  const handle = getGlobals().__milkdropRuntimeDebug;
  if (!handle) {
    return {
      presetId: null,
      backend: null,
      status: null,
      frameMs: null,
      fps: null,
      qualityStep: null,
      qualityStepCount: null,
      thermalState: null,
      sampleCount: null,
    };
  }
  const state = handle.getState();
  const perf = handle.getPerformance();
  const adaptive = handle.getAdaptiveQuality();
  return {
    presetId: state.activePresetId,
    backend: state.backend,
    status: state.status,
    frameMs: perf?.averageFrameMs ?? null,
    fps: perf?.averageFrameMs ? 1000 / perf.averageFrameMs : null,
    qualityStep: adaptive?.qualityStep ?? null,
    qualityStepCount: adaptive?.qualityStepCount ?? null,
    thermalState: adaptive?.thermalState ?? null,
    sampleCount: perf?.sampleCount ?? null,
  };
}

export function installAgentDriver(): void {
  if (typeof window === 'undefined' || !isAgentMode()) {
    return;
  }

  const driver: StimsAgentDriver = {
    version: 1,

    async ready({ timeoutMs = DEFAULT_READY_TIMEOUT_MS } = {}) {
      const globals = getGlobals();
      await withTimeout(
        (async () => {
          await Promise.all([
            globals.__stimsAppReady ?? Promise.resolve(),
            globals.__stimsStarterCatalogPromise ?? Promise.resolve(),
          ]);
          const handle = await waitForDriverHandle(timeoutMs);
          // Without this, a selectPreset() called right after ready()
          // resolves can race the runtime's own async startup preset
          // selection and get silently overwritten a moment later.
          await handle.startupSettled();
        })(),
        timeoutMs,
        'stims.agent.ready() timed out waiting for the app shell, starter ' +
          'catalog, and milkdrop runtime to be ready.',
      );
    },

    async selectPreset(
      presetId,
      { timeoutMs = DEFAULT_SELECT_TIMEOUT_MS } = {},
    ) {
      const handle = await waitForDriverHandle(timeoutMs);
      const start = performance.now();
      await withTimeout(
        // Always wait out the runtime's own startup preset selection first,
        // even if the caller skipped ready(): calling selectPreset while it
        // is still in flight lets the two race, and either one can silently
        // clobber the other a moment later.
        handle.startupSettled().then(() => handle.selectPreset(presetId)),
        timeoutMs,
        `stims.agent.selectPreset(${JSON.stringify(presetId)}) timed out after ${timeoutMs}ms.`,
      );
      const activePresetId = handle.getState().activePresetId;
      return {
        requestedPresetId: presetId,
        activePresetId,
        applied: activePresetId === presetId,
        elapsedMs: performance.now() - start,
      };
    },

    state: readState,

    setAutoplay(enabled) {
      getGlobals().__milkdropRuntimeDebug?.setAutoplay(enabled);
    },

    async waitForSettled({
      minFrames = 30,
      quietMs = 400,
      timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
    } = {}) {
      const handle = getGlobals().__milkdropRuntimeDebug;
      if (!handle) {
        return;
      }
      const start = performance.now();
      const startCount = handle.getPerformance()?.sampleCount ?? 0;
      let lastFrameMs = handle.getPerformance()?.averageFrameMs ?? null;
      let stableSince = performance.now();
      for (;;) {
        await sleep(100);
        const perf = handle.getPerformance();
        const count = perf?.sampleCount ?? 0;
        const frameMs = perf?.averageFrameMs ?? null;
        const now = performance.now();
        const delta =
          lastFrameMs !== null && frameMs !== null
            ? Math.abs(frameMs - lastFrameMs)
            : Number.POSITIVE_INFINITY;
        if (delta > 1.5) {
          stableSince = now;
        }
        lastFrameMs = frameMs;
        if (count - startCount >= minFrames && now - stableSince >= quietMs) {
          return;
        }
        if (now - start >= timeoutMs) {
          // Best-effort: a timeout here means "still moving," not an error.
          return;
        }
      }
    },
  };

  const globalNamespace = globalThis as StimsGlobalNamespace;
  globalNamespace.stims = { ...globalNamespace.stims, agent: driver };
}
