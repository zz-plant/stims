import { useEffect, useRef, useState } from 'react';
// Editor styles ship with this lazy chunk so visitors who never open the
// editor don't pay for them at startup.
import '../../css/editor-panel.css';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import type { MilkdropEditorSessionState } from '../milkdrop/types.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { FirstEditGuide } from './FirstEditGuide.tsx';
import { RepositorySupport } from './RepositorySupport.tsx';
import { copyRemixLinkAction } from './workspace-actions.ts';
import { useWorkspace } from './workspace-context.tsx';

/**
 * Workspace surface that hosts the MilkDrop editor overlay panel.
 *
 * The overlay's `EditorPanel` class (src/js/milkdrop/overlay/) owns the
 * CodeMirror IDE; this component is the React shell that mounts it into the
 * workspace, wires it to engine/session state, and renders the first-edit
 * guide and repository support around it. Named "surface" after
 * PerformSurface — the name EditorPanel belongs to the engine class.
 */
export function EditorSurface() {
  const [shared, setShared] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<{
    dispose: () => void;
    setSessionState: (state: MilkdropEditorSessionState) => void;
    setStageFrozen: (frozen: boolean) => void;
    element: HTMLElement;
  } | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();

  const engineRef = useRef(engine);
  engineRef.current = engine;

  const handleImportRef = useRef(ui.handleImport);
  handleImportRef.current = ui.handleImport;

  const uiRef = useRef(ui);
  uiRef.current = ui;

  const sessionState = engineSnapshot?.sessionState ?? null;
  // The panel is code-split, so it appends itself a tick or two after this
  // component renders. Session state only changes identity when a compile
  // commits, so by mount time the state that opened the editor will never be
  // re-delivered — without this ref the editor opens on an empty document and
  // stays that way until the first keystroke.
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    noteGrowthEvent('editor-opened');

    let cancelled = false;

    import('../milkdrop/overlay/editor-panel.ts').then(({ EditorPanel }) => {
      if (cancelled) return;

      const panel = new EditorPanel({
        onEditorSourceChange: (source: string) => {
          engineRef.current.updateEditorSource(source);
        },
        onLiveFieldChange: (key: string, value: number) => {
          engineRef.current.updateFieldLive(key, value);
        },
        onSetStageFrozen: (frozen: boolean) =>
          engineRef.current.setPlaybackPaused(frozen),
        onStepFrame: () => engineRef.current.stepPlaybackFrame(),
        getOriginalSource: () =>
          Promise.resolve(engineRef.current.getOriginalPresetSource()),
        onExport: () => {
          engineRef.current.exportPreset();
        },
        onDuplicatePreset: () => {
          void engineRef.current.duplicatePreset();
        },
        onDeletePreset: () => {
          void engineRef.current.deleteActivePreset();
        },
        // Was a no-op, which made the panel's Import button dead UI.
        onRequestImport: () => {
          importInputRef.current?.click();
        },
        // Reads the session through refs rather than closing over the render's
        // values: this callback is handed to the panel once, on mount, and a
        // captured source would freeze at whatever was on screen then.
        onCopyShareLink: () => {
          const activeId =
            sessionStateRef.current?.activeCompiled?.source.id ?? null;
          const entry = engineRef.current.catalog.find(
            (candidate) => candidate.id === activeId,
          );
          void copyRemixLinkAction({
            source: sessionStateRef.current?.source ?? '',
            dirty: sessionStateRef.current?.dirty ?? false,
            // Bundled presets are the ones anyone can load by id.
            local: Boolean(entry && !entry.bundledFile),
            title: entry?.title,
            announce: (message) => uiRef.current.setStatusMessage(message),
            onSuccess: () => setShared(true),
          });
        },
      });
      panelRef.current = panel;
      host.appendChild(panel.element);
      if (sessionStateRef.current) {
        panel.setSessionState(sessionStateRef.current);
      }
      panel.setStageFrozen(playbackPausedRef.current);
    });

    return () => {
      cancelled = true;
      panelRef.current?.dispose();
      panelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sessionState && panelRef.current) {
      panelRef.current.setSessionState(sessionState);
    }
  }, [sessionState]);

  // Space and the dock hold the stage too; keep Inspect's Freeze truthful.
  const playbackPaused = engineSnapshot?.playbackPaused ?? false;
  const playbackPausedRef = useRef(playbackPaused);
  playbackPausedRef.current = playbackPaused;
  useEffect(() => {
    panelRef.current?.setStageFrozen(playbackPaused);
  }, [playbackPaused]);

  return (
    <>
      {shared ? <RepositorySupport /> : null}
      {/* The panel appends itself after these children. The guide lives in
          the host so that, on a viewport too short for the code's minimum
          height, it scrolls away with the panel instead of staying pinned
          above it. */}
      <div ref={hostRef} className="stims-shell__editor-host">
        <FirstEditGuide
          key={engineSnapshot?.activePresetId}
          source={sessionState?.source ?? ''}
          onChange={(source) => engine.updateEditorSource(source)}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".milk,.zip,text/plain,application/zip"
          multiple
          hidden
          aria-label="Import preset files or a .zip pack"
          onChange={(event) => {
            void handleImportRef.current(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </>
  );
}
