import { useEffect, useRef } from 'react';
// Editor styles ship with this lazy chunk so visitors who never open the
// editor don't pay for them at startup.
import '../../css/editor-panel.css';
import type { MilkdropEditorSessionState } from '../milkdrop/types.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function EditorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<{
    dispose: () => void;
    setSessionState: (state: MilkdropEditorSessionState) => void;
    element: HTMLElement;
  } | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();

  const engineRef = useRef(engine);
  engineRef.current = engine;

  const handleImportRef = useRef(ui.handleImport);
  handleImportRef.current = ui.handleImport;

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
        onRevertToActive: () => {
          engineRef.current.revertEditorSource();
        },
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
      });
      panelRef.current = panel;
      host.appendChild(panel.element);
      if (sessionStateRef.current) {
        panel.setSessionState(sessionStateRef.current);
      }
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

  return (
    <div ref={hostRef} className="stims-shell__editor-host">
      <input
        ref={importInputRef}
        type="file"
        accept=".milk,text/plain"
        multiple
        hidden
        aria-label="Import preset file"
        onChange={(event) => {
          void handleImportRef.current(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
