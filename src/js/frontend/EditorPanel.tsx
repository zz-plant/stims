import { useEffect, useRef } from 'react';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import type { MilkdropEditorSessionState } from '../milkdrop/types.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function EditorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<{
    dispose: () => void;
    setSessionState: (state: MilkdropEditorSessionState) => void;
    setMidiTargets: (targets: Iterable<string>) => void;
    element: HTMLElement;
  } | null>(null);
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();

  const engineRef = useRef(engine);
  engineRef.current = engine;

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
      panel.setMidiTargets(webMidiService.getEnabledTargets());
      host.appendChild(panel.element);
    });

    return () => {
      cancelled = true;
      panelRef.current?.dispose();
      panelRef.current = null;
    };
  }, []);

  const sessionState = engineSnapshot?.sessionState ?? null;

  useEffect(() => {
    if (sessionState && panelRef.current) {
      panelRef.current.setSessionState(sessionState);
    }
  }, [sessionState]);

  useEffect(
    () =>
      webMidiService.onDevicesChanged(() => {
        panelRef.current?.setMidiTargets(webMidiService.getEnabledTargets());
      }),
    [],
  );

  return <div ref={hostRef} className="stims-shell__editor-host" />;
}
