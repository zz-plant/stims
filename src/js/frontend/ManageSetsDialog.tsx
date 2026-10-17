import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import {
  buildPresetSetShareUrl,
  deleteSavedPresetSet,
  MAX_SET_TITLE_LENGTH,
  readSavedPresetSets,
  type SavedPresetSet,
  saveNamedSet,
} from './preset-sets.ts';

export function ManageSetsDialog({
  open,
  onClose,
  currentQueueIds,
  onLoadQueue,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  currentQueueIds: string[];
  onLoadQueue: (presetIds: string[]) => void;
  onNotify: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [sets, setSets] = useState<SavedPresetSet[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useFocusTrap({
    active: open,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: dialogRef as RefObject<HTMLDivElement | null>,
    initialFocus: 'container',
  });

  useEscapeHandler(open, onClose);
  useBottomOverlaySignal(open);

  useEffect(() => {
    if (open) {
      setSets(readSavedPresetSets());
      setIsSaving(false);
      setNewTitle('');
    }
  }, [open]);

  if (!open) return null;

  const handleSaveCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentQueueIds.length === 0) {
      onNotify('Your queue is empty. Queue some presets first.');
      return;
    }
    const title = newTitle.trim() || `Set (${currentQueueIds.length} presets)`;
    saveNamedSet(title, currentQueueIds);
    setSets(readSavedPresetSets());
    setNewTitle('');
    setIsSaving(false);
    onNotify(`Saved "${title}"!`);
  };

  const handleDelete = (id: string, title: string) => {
    deleteSavedPresetSet(id);
    setSets(readSavedPresetSets());
    onNotify(`Deleted "${title}".`);
  };

  const handleLoad = (set: SavedPresetSet) => {
    onLoadQueue(set.presetIds);
    onClose();
    onNotify(`Loaded "${set.title}" into queue.`);
  };

  const handleCopyLink = async (set: SavedPresetSet) => {
    const url = buildPresetSetShareUrl(
      window.location.href,
      set.title,
      set.presetIds,
    );
    try {
      await navigator.clipboard.writeText(url);
      onNotify(`Share link for "${set.title}" copied!`);
    } catch {
      onNotify('Could not copy link to clipboard.');
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handles keyboard dismiss
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click dismiss
    <div className="stims-shell__credits-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="stims-shell__credits-card"
        role="dialog"
        aria-modal="true"
        aria-label="Manage Preset Sets"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
        style={{ maxWidth: '520px', width: '92vw' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            Preset Sets
          </h2>
          <button
            type="button"
            className="cta-button ghost"
            onClick={onClose}
            aria-label="Close preset sets dialog"
            style={{ padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {isSaving ? (
          <form
            onSubmit={handleSaveCurrent}
            style={{
              marginBottom: '16px',
              padding: '12px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '6px',
            }}
          >
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '0.85rem',
              }}
            >
              Name this set:
              <input
                type="text"
                value={newTitle}
                onChange={(e) =>
                  setNewTitle(e.target.value.slice(0, MAX_SET_TITLE_LENGTH))
                }
                placeholder={`Set (${currentQueueIds.length} presets)`}
                style={{
                  width: '100%',
                  marginTop: '4px',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.5)',
                  color: 'inherit',
                  fontSize: '0.9rem',
                }}
              />
            </label>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end',
                marginTop: '8px',
              }}
            >
              <button
                type="button"
                className="cta-button ghost"
                onClick={() => setIsSaving(false)}
              >
                Cancel
              </button>
              <button type="submit" className="cta-button primary">
                Save
              </button>
            </div>
          </form>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            <button
              type="button"
              className="cta-button secondary"
              onClick={() => setIsSaving(true)}
              disabled={currentQueueIds.length === 0}
              style={{ width: '100%' }}
              data-action="save-current-queue-as-set"
            >
              + Save current queue as named set ({currentQueueIds.length}{' '}
              presets)
            </button>
          </div>
        )}

        <div
          style={{
            maxHeight: '280px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {sets.length === 0 ? (
            <p
              style={{
                opacity: 0.6,
                fontSize: '0.85rem',
                textAlign: 'center',
                padding: '24px 0',
              }}
            >
              No saved preset sets yet. Queue presets and click "Save current
              queue" above.
            </p>
          ) : (
            sets.map((set) => (
              <div
                key={set.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1, marginRight: '12px' }}>
                  <div
                    style={{
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {set.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                    {set.presetIds.length}{' '}
                    {set.presetIds.length === 1 ? 'preset' : 'presets'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="cta-button secondary"
                    onClick={() => handleLoad(set)}
                    style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                    title="Load into queue"
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    className="cta-button ghost"
                    onClick={() => handleCopyLink(set)}
                    style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                    title="Copy shareable link"
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    className="cta-button ghost"
                    onClick={() => handleDelete(set.id, set.title)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      opacity: 0.6,
                    }}
                    title="Delete set"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
