/**
 * The editable-preset half of a Milkdrop session: it owns the source buffer,
 * the compile that turns it into a renderable artifact, and the last-good
 * artifact to keep showing when a compile fails.
 *
 * Compiles run in a worker, because preset loads and live field edits happen
 * mid-playback and a heavy preset compiled on the main thread stalls the
 * visual for hundreds of milliseconds (seconds on mobile). Everything awkward
 * in here follows from that: a lease so a burst of keystrokes spawns one
 * worker rather than one per keystroke, a per-compile watchdog so a wedged
 * worker hands the work back to the main thread instead of stranding it, a
 * commit id so a preset swap cannot be overwritten by an older compile still
 * in flight, and an explicit push of the session's branch-desugar setting,
 * since the worker is its own module instance and sees none of the page's
 * module-level state.
 *
 * What it does not own: choosing which preset to load or when (the runtime's
 * preset-navigation controller), the compiler itself (`./compiler`), and
 * anything about rendering — this module's output is an artifact, and someone
 * else decides what to do with it.
 */
import { type Remote, releaseProxy, wrap } from 'comlink';
import { createLogger } from '../core/logger';
import { isAgentMode } from '../core/url-params';
import { compileMilkdropPresetSource } from './compiler';
import { isShaderBranchDesugarEnabled } from './compiler/shader-branch-desugar';
import { upsertMilkdropField, upsertMilkdropFields } from './formatter';
import type {
  MilkdropCompiledPreset,
  MilkdropEditorCompiler,
  MilkdropEditorSession,
  MilkdropEditorSessionState,
  MilkdropPresetSource,
} from './types';

const logger = createLogger('EditorSession');

const IS_DEV =
  typeof window !== 'undefined'
    ? isAgentMode() || window.location.hostname === 'localhost'
    : false;

function editorLog(sourceId: string, msg: string, ...args: unknown[]) {
  if (!IS_DEV) return;
  logger.info(`[${sourceId}] ${msg}`, ...args);
}

function editorWarn(sourceId: string, msg: string, ...args: unknown[]) {
  if (!IS_DEV) return;
  logger.warn(`[${sourceId}] ⚠ ${msg}`, ...args);
}

function hasErrors(compiled: MilkdropCompiledPreset) {
  return compiled.diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  );
}

const DEFAULT_COMPILE_TIMEOUT_MS = 1000;

/** Race outcomes that mean "the worker is not going to answer this one". */
const TIMED_OUT = Symbol('editor-compile-timed-out');
const RETIRED = Symbol('editor-worker-retired');
const WORKER_FAILED = Symbol('editor-worker-failed');

/**
 * One live compile worker plus the bookkeeping needed to tear it down without
 * stranding the compiles already riding on it. A retired lease resolves
 * `retired`, which every in-flight compile is racing against, so terminating
 * the worker hands each of them back to the main-thread compiler instead of
 * leaving their promises pending forever.
 */
type WorkerLease = {
  worker: Worker;
  compiler: Remote<MilkdropEditorCompiler>;
  retired: Promise<typeof RETIRED>;
  markRetired: (value: typeof RETIRED) => void;
  isRetired: boolean;
  /**
   * The `shaderBranchDesugar` value this worker was last told about, or null
   * before it has been told anything. The flag lives in a module-level boolean
   * that a worker's own module instance defaults to `false`, so an unsynced
   * worker silently compiles every preset as if the session had opted out.
   */
  shaderBranchDesugar: boolean | null;
};

type CompileOutcome =
  | { kind: 'compiled'; compiled: MilkdropCompiledPreset }
  /** The session was disposed mid-compile; the caller must not touch state. */
  | { kind: 'aborted' };

export function createMilkdropEditorSession({
  initialPreset,
  initialCompiled,
  compileTimeoutMs = DEFAULT_COMPILE_TIMEOUT_MS,
}: {
  initialPreset: MilkdropPresetSource;
  initialCompiled?: MilkdropCompiledPreset;
  /** Worker watchdog budget. Overridable so tests need not burn a real second. */
  compileTimeoutMs?: number;
}): MilkdropEditorSession {
  const listeners = new Set<(state: MilkdropEditorSessionState) => void>();
  const watchdogs = new Set<ReturnType<typeof setTimeout>>();
  let lease: WorkerLease | null = null;
  /** In-flight worker bring-up, shared so a burst of keystrokes spawns one
   * worker rather than one per keystroke. */
  let leasePending: Promise<WorkerLease | null> | null = null;
  /** Latched once construction fails (CSP, blocked blob URL, no worker
   * support): retrying on every edit only pays the cost again. */
  let workerUnavailable = false;
  let disposed = false;
  let commitId = 0;
  let sourceMeta: MilkdropPresetSource = initialPreset;
  /** Newest source handed to `commit`, whether or not it has compiled yet.
   * Field edits build on this so two nudges inside one compile window stack
   * instead of the second silently discarding the first. */
  let pendingSource = initialPreset.raw;
  let renderable =
    initialCompiled ??
    compileMilkdropPresetSource(initialPreset.raw, initialPreset);
  let state: MilkdropEditorSessionState = {
    source: initialPreset.raw,
    latestCompiled: renderable,
    activeCompiled: renderable,
    diagnostics: renderable.diagnostics,
    dirty: false,
  };

  const notify = () => {
    listeners.forEach((listener) => listener(state));
  };

  const retireLease = (target: WorkerLease, reason: string) => {
    if (target.isRetired) return;
    target.isRetired = true;
    if (lease === target) {
      lease = null;
    }
    target.markRetired(RETIRED);
    editorLog(sourceMeta.id, `retiring editor worker (${reason})`);
    try {
      void target.compiler[releaseProxy]();
    } catch {
      // The proxy is already unusable; terminating is what matters.
    }
    target.worker.terminate();
  };

  /**
   * Pushes the session's branch-desugar setting into the worker before it
   * compiles anything. Sent, not awaited: comlink delivers messages in order
   * and the worker sets the flag synchronously while handling this one, so the
   * compile that follows already sees it. Awaiting a round-trip here would put
   * an unwatchdogged wait in front of every preset load, and a wedged worker
   * would strand the load instead of falling back to the main thread.
   */
  const syncShaderBranchDesugar = (target: WorkerLease) => {
    const enabled = isShaderBranchDesugarEnabled();
    if (target.shaderBranchDesugar === enabled) {
      return;
    }
    target.shaderBranchDesugar = enabled;
    void target.compiler.setShaderBranchDesugar(enabled).catch((error) => {
      // A worker that cannot take the setting will compile with the default,
      // which is the pre-flag behaviour — wrong classification, not a crash.
      target.shaderBranchDesugar = null;
      editorWarn(
        sourceMeta.id,
        'worker refused the shader-branch-desugar setting',
        error,
      );
    });
  };

  const acquireLease = async (): Promise<WorkerLease | null> => {
    if (disposed || workerUnavailable || typeof Worker === 'undefined') {
      return null;
    }
    if (lease) return lease;
    if (!leasePending) {
      leasePending = (async () => {
        try {
          const { default: EditorWorkerCtor } = await import(
            './editor-worker.ts?worker'
          );
          if (disposed) return null;
          const instance = new EditorWorkerCtor();
          let markRetired: (value: typeof RETIRED) => void = () => {};
          const retired = new Promise<typeof RETIRED>((resolve) => {
            markRetired = resolve;
          });
          const next: WorkerLease = {
            worker: instance,
            compiler: wrap<MilkdropEditorCompiler>(instance),
            retired,
            markRetired,
            isRetired: false,
            shaderBranchDesugar: null,
          };
          syncShaderBranchDesugar(next);
          lease = next;
          return next;
        } catch (error) {
          workerUnavailable = true;
          editorWarn(
            sourceMeta.id,
            'editor worker could not start, compiling on the main thread from here on',
            error,
          );
          return null;
        } finally {
          leasePending = null;
        }
      })();
    }
    return leasePending;
  };

  const compile = async ({
    source,
    meta,
    useWorker = true,
    cacheCompile = false,
  }: {
    source: string;
    meta: MilkdropPresetSource;
    useWorker?: boolean;
    cacheCompile?: boolean;
  }): Promise<CompileOutcome> => {
    if (disposed) return { kind: 'aborted' };

    const activeLease = useWorker ? await acquireLease() : null;
    if (disposed) return { kind: 'aborted' };

    if (!activeLease) {
      editorLog(
        meta.id,
        'compile on main thread (worker unavailable or disabled)',
      );
      return {
        kind: 'compiled',
        compiled: compileMilkdropPresetSource(
          source,
          meta,
          cacheCompile ? { cacheCompile: true } : {},
        ),
      };
    }

    syncShaderBranchDesugar(activeLease);

    editorLog(meta.id, 'compile via worker');
    // Each compile owns its watchdog. A single shared timer handle let one
    // compile's completion cancel another's watchdog, leaving that one with no
    // way back if the worker never answered.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      watchdog = setTimeout(() => resolve(TIMED_OUT), compileTimeoutMs);
      watchdogs.add(watchdog);
    });
    const clearWatchdog = () => {
      if (watchdog === undefined) return;
      clearTimeout(watchdog);
      watchdogs.delete(watchdog);
      watchdog = undefined;
    };

    const fromWorker = activeLease.compiler
      .compile(source, meta, cacheCompile ? { cacheCompile: true } : undefined)
      .catch((error): typeof WORKER_FAILED => {
        editorWarn(meta.id, 'worker compilation failed', error);
        return WORKER_FAILED;
      });

    const outcome = await Promise.race([
      fromWorker,
      timeout,
      activeLease.retired,
    ]);
    clearWatchdog();

    if (outcome === TIMED_OUT) {
      editorWarn(
        meta.id,
        `worker compile exceeded ${compileTimeoutMs}ms — falling back to the main thread`,
      );
      retireLease(activeLease, 'compile timed out');
    } else if (outcome === RETIRED) {
      editorLog(
        meta.id,
        'worker retired mid-compile — falling back to the main thread',
      );
    } else if (outcome !== WORKER_FAILED) {
      return { kind: 'compiled', compiled: outcome };
    }

    if (disposed) return { kind: 'aborted' };
    return {
      kind: 'compiled',
      compiled: compileMilkdropPresetSource(source, meta),
    };
  };

  const commit = async (
    source: string,
    options: {
      markClean?: boolean;
      useWorker?: boolean;
      cacheCompile?: boolean;
    } = {},
  ) => {
    if (disposed) return state;

    const currentCommitId = ++commitId;
    // Pin the preset identity now: a preset swap while this compile is in
    // flight must not retag it with the incoming preset's metadata.
    const meta = sourceMeta;
    pendingSource = source;

    const compileStart = performance.now();
    const outcome = await compile({
      source,
      meta,
      useWorker: options.useWorker,
      cacheCompile: options.cacheCompile,
    });
    const compileDuration = performance.now() - compileStart;

    if (outcome.kind === 'aborted') {
      return state;
    }
    if (currentCommitId !== commitId) {
      editorLog(
        meta.id,
        `commit #${currentCommitId} superseded by #${commitId}, discarding`,
      );
      return state;
    }

    const compiled = outcome.compiled;
    const failed = hasErrors(compiled);
    if (failed) {
      const errorCount = compiled.diagnostics.filter(
        (d) => d.severity === 'error',
      ).length;
      editorWarn(
        meta.id,
        `compile had ${errorCount} error(s) in ${compileDuration.toFixed(1)}ms — falling back to last-good`,
      );
    } else {
      renderable = compiled;
    }

    const activeCompiled = failed ? renderable : compiled;
    // Only rewrite the buffer with formatted text when this source actually
    // compiled. Reformatting a failed compile would paste the *previous*
    // preset's source over the one the user just opened, putting the broken
    // text permanently out of reach.
    const nextSource =
      options.markClean && !failed ? compiled.formattedSource : source;

    pendingSource = nextSource;
    state = {
      source: nextSource,
      latestCompiled: compiled,
      activeCompiled,
      diagnostics: compiled.diagnostics,
      dirty: options.markClean
        ? false
        : nextSource.trim() !== activeCompiled.formattedSource.trim(),
    };
    notify();
    return state;
  };

  return {
    getState() {
      return state;
    },

    async loadPreset(source) {
      sourceMeta = source;
      // Compile in the worker: preset loads happen mid-playback, and a heavy
      // preset compiled on the main thread stalls the running visual for
      // hundreds of ms to seconds (measured on a Galaxy S22). The worker
      // path falls back to a main-thread compile on spawn failure/timeout.
      editorLog(source.id, 'loadPreset (worker compile, mark clean)');
      return commit(source.raw, {
        markClean: true,
        useWorker: true,
        cacheCompile: true,
      });
    },

    async applySource(source) {
      return commit(source);
    },

    async updateField(key, value) {
      return commit(upsertMilkdropField(pendingSource, key, value));
    },

    async updateFields(updates) {
      return commit(upsertMilkdropFields(pendingSource, updates));
    },

    async resetToActive() {
      const activeSource =
        state.activeCompiled?.formattedSource ?? state.source;
      return commit(activeSource, { markClean: true });
    },

    subscribe(listener) {
      if (disposed) {
        listener(state);
        return () => {};
      }
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      watchdogs.forEach((timer) => clearTimeout(timer));
      watchdogs.clear();
      if (lease) {
        retireLease(lease, 'session disposed');
      }
      leasePending = null;
      listeners.clear();
    },
  };
}
