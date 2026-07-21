import { type Remote, releaseProxy, wrap } from 'comlink';
import { createLogger } from '../core/logger';
import { compileMilkdropPresetSource } from './compiler';
import { upsertMilkdropField } from './formatter';
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
    ? window.location.search.includes('agent=true') ||
      window.location.hostname === 'localhost'
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

export function createMilkdropEditorSession({
  initialPreset,
  initialCompiled,
}: {
  initialPreset: MilkdropPresetSource;
  initialCompiled?: MilkdropCompiledPreset;
}): MilkdropEditorSession {
  const listeners = new Set<(state: MilkdropEditorSessionState) => void>();
  let worker: Worker | null = null;
  let compiler: Remote<MilkdropEditorCompiler> | null = null;
  let commitId = 0;
  let sourceMeta: MilkdropPresetSource = initialPreset;
  let lastGood =
    initialCompiled ??
    compileMilkdropPresetSource(initialPreset.raw, initialPreset);
  let state: MilkdropEditorSessionState = {
    source: initialPreset.raw,
    latestCompiled: lastGood,
    activeCompiled: lastGood,
    diagnostics: lastGood.diagnostics,
    dirty: false,
  };

  const notify = () => {
    listeners.forEach((listener) => listener(state));
  };

  const ensureCompiler = (useWorker = true) => {
    if (!useWorker) return null;
    if (compiler || typeof Worker === 'undefined') {
      return compiler;
    }
    worker = new Worker(new URL('./editor-worker.ts', import.meta.url), {
      type: 'module',
    });
    compiler = wrap<MilkdropEditorCompiler>(worker);
    return compiler;
  };

  const compile = ({
    source,
    useWorker = true,
  }: {
    source: string;
    useWorker?: boolean;
  }) => {
    const activeCompiler = ensureCompiler(useWorker);
    if (!activeCompiler) {
      editorLog(
        sourceMeta.id,
        'compile on main thread (worker unavailable or disabled)',
      );
      return Promise.resolve(compileMilkdropPresetSource(source, sourceMeta));
    }

    editorLog(sourceMeta.id, 'compile via worker');
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Worker compilation timed out')), 1000),
    );
    return Promise.race([
      activeCompiler.compile(source, sourceMeta),
      timeout,
    ]).catch((error) => {
      editorWarn(
        sourceMeta.id,
        'worker compilation failed or timed out, falling back to main thread',
        error,
      );
      if (error && error.message === 'Worker compilation timed out') {
        worker?.terminate();
        worker = null;
        compiler = null;
      }
      return compileMilkdropPresetSource(source, sourceMeta);
    });
  };

  const commit = async (
    source: string,
    options: {
      markClean?: boolean;
      useWorker?: boolean;
    } = {},
  ) => {
    const currentCommitId = ++commitId;
    const compileStart = performance.now();
    const compiled = await compile({
      source,
      useWorker: options.useWorker,
    });
    const compileDuration = performance.now() - compileStart;
    if (currentCommitId !== commitId) {
      editorLog(
        sourceMeta.id,
        `commit #${currentCommitId} superseded by #${commitId}, discarding`,
      );
      return state;
    }
    if (!hasErrors(compiled)) {
      lastGood = compiled;
    } else {
      const errorCount = compiled.diagnostics.filter(
        (d) => d.severity === 'error',
      ).length;
      editorWarn(
        sourceMeta.id,
        `compile had ${errorCount} error(s) in ${compileDuration.toFixed(1)}ms — falling back to last-good`,
      );
    }

    const activeCompiled = hasErrors(compiled) ? lastGood : compiled;
    const formattedSource = activeCompiled.formattedSource;
    const nextSource = options.markClean ? formattedSource : source;

    state = {
      source: nextSource,
      latestCompiled: compiled,
      activeCompiled,
      diagnostics: compiled.diagnostics,
      dirty: options.markClean
        ? false
        : nextSource.trim() !== formattedSource.trim(),
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
      editorLog(source.id, 'loadPreset (main-thread compile, mark clean)');
      return commit(source.raw, { markClean: true, useWorker: false });
    },

    async applySource(source) {
      return commit(source);
    },

    async updateField(key, value) {
      const baseline = state.latestCompiled?.formattedSource ?? state.source;
      return commit(upsertMilkdropField(baseline, key, value));
    },

    async resetToActive() {
      const activeSource =
        state.activeCompiled?.formattedSource ?? state.source;
      return commit(activeSource, { markClean: true });
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      void compiler?.[releaseProxy]();
      compiler = null;
      worker?.terminate();
      worker = null;
      listeners.clear();
    },
  };
}
