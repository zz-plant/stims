/**
 * Engine actions the workspace hands to components unchanged.
 *
 * Each of these used to be written out three times — a forwarding wrapper in
 * workspace-hooks, a copy into the context value (and its dependency list)
 * in workspace-context, and a signature in engine-context — before a
 * component could call it, and a new engine action meant editing all three.
 * Here the list is one line per action; the wrappers are generated, and the
 * types come from the engine adapter itself, so a signature cannot drift.
 *
 * Only pure forwards belong here: an action that also does workspace work
 * (routing, audio elements, status messages) stays written out where it is.
 */
import type { MilkdropEngineAdapter } from './milkdrop-engine-adapter.ts';

/**
 * Each forwarded action, with what it returns while no engine is mounted.
 * `async` marks actions whose result the caller awaits.
 */
const FORWARDED = {
  exportPreset: { fallback: undefined },
  exportUserPresets: { fallback: 0, async: true },
  goBackPreset: { fallback: undefined, async: true },
  revertEditorSource: { fallback: undefined },
  duplicatePreset: { fallback: undefined, async: true },
  deleteActivePreset: { fallback: undefined, async: true },
  getVideoExportRuntime: { fallback: null },
  setAutoplay: { fallback: undefined },
  setTransitionMode: { fallback: undefined },
  startManualCrossfade: { fallback: undefined },
  setCrossfade: { fallback: undefined },
  getCrossfade: { fallback: null },
  setBlendDuration: { fallback: undefined },
  updateEditorSource: { fallback: undefined },
  updateFieldLive: { fallback: undefined },
  stepPlaybackFrame: { fallback: false },
  applyEditorSourceAwaited: { fallback: null, async: true },
  applyEditorFieldsAwaited: { fallback: null, async: true },
  getEditorSessionState: { fallback: null },
  getActiveCompiledPreset: { fallback: null },
  pausePreview: { fallback: undefined },
  resumePreview: { fallback: undefined },
} as const satisfies Record<string, { fallback: unknown; async?: boolean }>;

type ForwardedName = keyof typeof FORWARDED & keyof MilkdropEngineAdapter;
type Fn = (...args: never[]) => unknown;
type Fallback<Name extends ForwardedName> =
  (typeof FORWARDED)[Name]['fallback'];

/** The adapter's own signature, widened by what it returns when unmounted. */
export type ForwardedEngineActions = {
  [Name in ForwardedName]: MilkdropEngineAdapter[Name] extends (
    ...args: infer Args
  ) => infer Result
    ? (
        ...args: Args
      ) => Result extends Promise<infer Value>
        ? Promise<Value | Fallback<Name>>
        : Result | Fallback<Name>
    : never;
};

export const FORWARDED_ENGINE_ACTION_NAMES = Object.keys(
  FORWARDED,
) as ForwardedName[];

/**
 * One wrapper per forwarded action, reading the engine at call time so the
 * object can be created once and stay stable across renders.
 */
export function createForwardedEngineActions(
  getEngine: () => MilkdropEngineAdapter | null,
): ForwardedEngineActions {
  const actions: Record<string, Fn> = {};
  for (const name of FORWARDED_ENGINE_ACTION_NAMES) {
    const spec: { fallback: unknown; async?: boolean } = FORWARDED[name];
    actions[name] = (...args: never[]) => {
      const engine = getEngine();
      const method = engine?.[name] as Fn | undefined;
      if (!engine || !method) {
        return spec.async ? Promise.resolve(spec.fallback) : spec.fallback;
      }
      const result = method.apply(engine, args);
      if (spec.async) {
        return Promise.resolve(result).then((value) => value ?? spec.fallback);
      }
      return result ?? spec.fallback;
    };
  }
  return actions as unknown as ForwardedEngineActions;
}
