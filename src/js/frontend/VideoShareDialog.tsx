/** Explicit publishing; opening the dialog records and uploads nothing. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../../css/VideoShareDialog.module.css';
import { shareOrCopyLink } from '../utils/media/share-link.ts';
import { captureSocialPreview } from './engine/capture-social-preview.ts';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import { useTwoStepConfirm } from './hooks/use-two-step-confirm.ts';
import { codeForLocalShare } from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type Published = { url: string; id: string; deleteToken: string | null };

export function VideoShareDialog({ onClose }: { onClose(): void }) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const snapshot = useRef(engineSnapshot);
  snapshot.current = engineSnapshot;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [published, setPublished] = useState<Published | null>(null);
  useFocusTrap({
    active: true,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: dialogRef,
    initialFocus: 'container',
  });
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  useEscapeHandler(true, close);
  useBottomOverlaySignal(true);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/flipbooks/', { signal: abort.signal })
      .then(async (r) => {
        const result = r.ok ? await r.json() : null;
        if (!abort.signal.aborted) setAvailable(result?.available === true);
      })
      .catch(() => {
        if (!abort.signal.aborted) setAvailable(false);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);

  const publish = async () => {
    const stage = ui.stageRef.current;
    const original = snapshot.current;
    const source = original?.sessionState?.source;
    const presetId = original?.activePresetId;
    if (!stage || !source || !presetId || !original.runtimeReady) {
      setMessage('Start the visualizer before creating a video link.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage('Capturing four seconds. Keep this preset playing.');
    try {
      const clip = await captureSocialPreview(
        stage,
        abort.signal,
        () =>
          snapshot.current?.activePresetId === presetId &&
          snapshot.current?.sessionState?.source === source,
      );
      const entry = engine.selectedPreset ?? engine.featuredPreset;
      setMessage('Publishing your preview and preset code…');
      const response = await fetch('/api/flipbooks/', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: entry?.title?.slice(0, 160) || 'Shared preset',
          presetId,
          source: codeForLocalShare(source, {
            local: !entry?.bundledFile,
            dirty: Boolean(original.sessionState?.dirty),
            title: entry?.title,
          }),
          clip,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not publish this preview.');
      if (!abort.signal.aborted) {
        setPublished(result);
        setMessage('Your public video link is ready.');
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not publish this preview.',
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };

  const remove = async () => {
    if (!published?.deleteToken) return;
    const response = await fetch(`/api/flipbooks/${published.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${published.deleteToken}` },
    });
    if (response.ok) {
      setPublished(null);
      setMessage(
        'The public link was deleted. Previously downloaded or cached copies may remain.',
      );
    } else setMessage('Could not delete the public link. Try again.');
  };

  // Deleting takes the page down for everyone the link went to; one press
  // arms it, the second deletes.
  const confirmDelete = useTwoStepConfirm(() => {
    void remove().catch(() =>
      setMessage('Could not delete the link. Try again.'),
    );
  });

  return createPortal(
    <div className="stims-shell__credits-overlay">
      <div
        ref={dialogRef}
        className={`stims-shell__credits-card ${styles.card}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-share-title"
        tabIndex={-1}
      >
        <h2 id="video-share-title">Create a video link</h2>
        <p>
          This publishes a small, silent preview and this preset’s code to
          Stims. Anyone with the link can view or copy them. Your audio stays in
          your browser.
        </p>
        {available === false ? (
          <p>Video publishing is unavailable. You can still use Share link.</p>
        ) : null}
        <p role="status">
          {message ||
            (available === null
              ? 'Checking availability…'
              : 'Nothing is captured until you choose Create public link.')}
        </p>
        {published ? (
          <>
            {/* A new tab: in this one the link replaced the live session,
                audio and any unsaved edit with the published page. */}
            <p style={{ overflowWrap: 'anywhere' }}>
              <a
                href={published.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open the public page in a new tab: ${published.url}`}
              >
                {published.url}
              </a>
            </p>
            <button
              type="button"
              className="cta-button"
              onClick={() => {
                void shareOrCopyLink(published.url).then((result) =>
                  setMessage(
                    result === 'copied'
                      ? 'Video link copied.'
                      : result === 'shared'
                        ? 'Video link shared.'
                        : 'Use the link above to share.',
                  ),
                );
              }}
            >
              Share or copy link
            </button>
            {published.deleteToken ? (
              <button
                type="button"
                className="cta-button ghost"
                data-armed={confirmDelete.armed ? 'true' : undefined}
                onClick={confirmDelete.press}
                onBlur={confirmDelete.disarm}
              >
                {confirmDelete.armed
                  ? 'Delete it for everyone'
                  : 'Delete public link'}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className="cta-button primary"
            disabled={!available || busy}
            onClick={() => {
              void publish();
            }}
          >
            {busy ? 'Creating…' : 'Create public link'}
          </button>
        )}
        <button type="button" className="cta-button ghost" onClick={close}>
          {busy ? 'Cancel' : 'Close'}
        </button>
      </div>
    </div>,
    document.fullscreenElement ??
      document.querySelector('.stims-shell') ??
      document.body,
  );
}
