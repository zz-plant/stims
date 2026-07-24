import { useEffect, useRef } from 'react';

export function EditorPanel() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let panel: InstanceType<
      typeof import('../milkdrop/overlay/editor-panel.ts').EditorPanel
    > | null = null;

    import('../milkdrop/overlay/editor-panel.ts').then(({ EditorPanel }) => {
      panel = new EditorPanel({
        onEditorSourceChange: (source) => {
          window.dispatchEvent(
            new CustomEvent('stims:editor:source-change', {
              detail: { source },
            }),
          );
        },
        onRevertToActive: () => {
          window.dispatchEvent(new CustomEvent('stims:editor:revert'));
        },
        onExport: () => {
          window.dispatchEvent(new CustomEvent('stims:editor:export'));
        },
        onDuplicatePreset: () => {
          window.dispatchEvent(new CustomEvent('stims:editor:duplicate'));
        },
        onDeletePreset: () => {
          window.dispatchEvent(new CustomEvent('stims:editor:delete'));
        },
        onRequestImport: () => {},
      });
      host.appendChild(panel.element);
    });

    return () => {
      panel?.element.remove();
      panel = null;
    };
  }, []);

  return <div ref={hostRef} className="stims-shell__editor-host" />;
}
