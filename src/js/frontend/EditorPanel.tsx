import { useEffect, useRef } from 'react';
import type { MilkdropEditorSessionState } from '../milkdrop/types.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function EditorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<{
    dispose: () => void;
    setSessionState: (state: MilkdropEditorSessionState) => void;
    element: HTMLElement;
  } | null>(null);
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();

  const engineRef = useRef(engine);
  engineRef.current = engine;

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
        onRequestImport: () => {},
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

  return <div ref={hostRef} className="stims-shell__editor-host" />;
}
