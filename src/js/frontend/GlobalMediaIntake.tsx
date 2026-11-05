/**
 * Takes audio and presets dropped anywhere on the page, and a YouTube link
 * pasted anywhere outside a text field. Both used to work only inside the
 * audio panel, which on a running stage sits two steps away in Settings.
 */
import '../../css/shell/global-drop.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseYouTubeVideoReference } from '../ui/youtube-controller.ts';
import { displayAudioCapture } from './display-audio-capture.ts';
import { playAudioFiles } from './file-audio.ts';
import { useWorkspace } from './workspace-context.tsx';

const carriesFiles = (event: DragEvent) =>
  Boolean(event.dataTransfer?.types.includes('Files'));

const isPreset = (file: File) => file.name.toLowerCase().endsWith('.milk');

/** The code editor and text fields keep their own drops and pastes. */
function targetTakesText(target: EventTarget | null): boolean {
  return Boolean(
    (target as Partial<Element> | null)?.closest?.(
      'input, textarea, select, [contenteditable="true"], .cm-editor',
    ),
  );
}

export function GlobalMediaIntake() {
  const { ui, engine } = useWorkspace();
  const [dragging, setDragging] = useState(false);
  // Listeners stay attached for the page's life, and read the latest values.
  // Synced after commit rather than during render, so React Compiler can
  // compile this component (#1540); events only fire after commit anyway.
  const latest = useRef({ ui, engine });
  useLayoutEffect(() => {
    latest.current = { ui, engine };
  }, [ui, engine]);

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed, so only the
    // count coming back to zero means the drag left the page.
    let depth = 0;
    const endDrag = () => {
      depth = 0;
      setDragging(false);
    };
    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth -= 1;
      if (depth <= 0) endDrag();
    };
    const onDragOver = (event: DragEvent) => {
      // Without this the browser navigates to the file when it lands.
      if (carriesFiles(event) && !targetTakesText(event.target)) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      endDrag();
      // A drop zone of its own, such as the audio card, already took it.
      if (event.defaultPrevented || targetTakesText(event.target)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      const { ui: currentUi, engine: currentEngine } = latest.current;
      const presets = files.filter(isPreset);
      if (presets.length > 0 && presets.length === files.length) {
        void currentUi.handleImport(presets);
        return;
      }
      if (!currentEngine.engineReady) {
        currentUi.setStatusMessage('The visualizer is still loading.');
        return;
      }
      void playAudioFiles(
        files.filter((file) => !isPreset(file)),
        {
          routeState: currentUi.routeState,
          commitRoute: currentUi.commitRoute,
          startAudioSource: currentEngine.startAudioSource,
        },
      ).then((result) => {
        latest.current.ui.setStatusMessage(
          !result.ok
            ? result.error
            : result.count > 1
              ? `Playing ${result.name} (1 of ${result.count})`
              : `Playing ${result.name}`,
        );
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (targetTakesText(event.target)) return;
      if (!displayAudioCapture().canCaptureDisplayAudio) return;
      const text = event.clipboardData?.getData('text').trim() ?? '';
      if (!text || !parseYouTubeVideoReference(text)) return;
      event.preventDefault();
      const { ui: currentUi, engine: currentEngine } = latest.current;
      currentUi.setYoutubeUrl(text);
      void currentEngine.loadYouTubePreview(text);
      // The landing shows the field as soon as it holds a link. On a running
      // stage the field lives in Settings, and capture still needs its button:
      // the browser only opens the share dialog from a fresh click.
      if (currentEngine.audioActive) currentUi.updatePanel('settings');
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className="stims-shell__global-drop" aria-hidden="true">
      <p>Drop audio to play it, or a .milk preset to open it</p>
    </div>
  );
}
