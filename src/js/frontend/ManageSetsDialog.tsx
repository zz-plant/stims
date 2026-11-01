import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import { useTwoStepConfirm } from './hooks/use-two-step-confirm.ts';
import {
  buildPresetSetShareUrl,
  deleteSavedPresetSet,
  MAX_SET_TITLE_LENGTH,
  readSavedPresetSets,
  type SavedPresetSet,
  saveNamedSet,
} from './preset-sets.ts';
import { UiIcon } from './UiIcon.tsx';

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
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const saveTriggerRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    if (isSaving) {
      titleInputRef.current?.focus();
    }
  }, [isSaving]);

  if (!open) return null;

  const cancelSaving = () => {
    setIsSaving(false);
    setNewTitle('');
    requestAnimationFrame(() => {
      saveTriggerRef.current?.focus();
    });
  };

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
        className="stims-shell__credits-card stims-shell__credits-card--compact"
        data-shell-dialog="true"
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
      >
        <div className="stims-shell__dialog-head">
          <h2 className="stims-shell__dialog-title">Preset Sets</h2>
          <button
            type="button"
            className="cta-button ghost stims-shell__dialog-close"
            onClick={onClose}
            aria-label="Close preset sets dialog"
          >
            <UiIcon
              name="close"
              className="stims-icon-slot stims-icon-slot--sm"
              aria-hidden="true"
            />
          </button>
        </div>

        {isSaving ? (
          <form
            className="stims-shell__set-form"
            onSubmit={handleSaveCurrent}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelSaving();
              }
            }}
          >
            <label className="stims-shell__set-field">
              Name this set:
              <input
                ref={titleInputRef}
                type="text"
                className="stims-shell__input"
                value={newTitle}
                onChange={(e) =>
                  setNewTitle(e.target.value.slice(0, MAX_SET_TITLE_LENGTH))
                }
                placeholder={`Set (${currentQueueIds.length} presets)`}
              />
            </label>
            <div className="stims-shell__set-actions">
              <button
                type="button"
                className="cta-button ghost"
                onClick={cancelSaving}
              >
                Cancel
              </button>
              <button type="submit" className="cta-button primary">
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="stims-shell__set-trigger">
            <button
              ref={saveTriggerRef}
              type="button"
              className="cta-button secondary"
              onClick={() => setIsSaving(true)}
              disabled={currentQueueIds.length === 0}
              data-action="save-current-queue-as-set"
            >
              + Save current queue as named set ({currentQueueIds.length}{' '}
              presets)
            </button>
          </div>
        )}

        {sets.length > 0 && currentQueueIds.length > 0 ? (
          <p className="stims-shell__set-note">
            Loading a set replaces your current queue ({currentQueueIds.length}{' '}
            {currentQueueIds.length === 1 ? 'preset' : 'presets'}).
          </p>
        ) : null}

        <div className="stims-shell__set-list">
          {sets.length === 0 ? (
            <p className="stims-shell__set-empty">
              No saved preset sets yet. Queue presets and click "Save current
              queue" above.
            </p>
          ) : (
            sets.map((set) => (
              <SavedSetRow
                key={set.id}
                set={set}
                replacesQueue={currentQueueIds.length > 0}
                onLoad={() => handleLoad(set)}
                onCopyLink={() => void handleCopyLink(set)}
                onDelete={() => handleDelete(set.id, set.title)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One saved set. Its own component so each row's delete can ask once, in
 * place: deleting a set has no undo, and its control used to be a bare ✕
 * right under the dialog's own close ✕.
 */
function SavedSetRow({
  set,
  replacesQueue,
  onLoad,
  onCopyLink,
  onDelete,
}: {
  set: SavedPresetSet;
  replacesQueue: boolean;
  onLoad: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  const deleteConfirm = useTwoStepConfirm(onDelete);
  return (
    <div className="stims-shell__set-row">
      <div className="stims-shell__set-meta">
        <div className="stims-shell__set-title">{set.title}</div>
        <div className="stims-shell__set-sub">
          {set.presetIds.length}{' '}
          {set.presetIds.length === 1 ? 'preset' : 'presets'}
        </div>
      </div>
      <div className="stims-shell__set-row-actions">
        {/* It fills the queue and plays nothing; it used to read "Play". */}
        <button
          type="button"
          className="cta-button secondary stims-shell__set-btn"
          onClick={onLoad}
          aria-label={`${replacesQueue ? 'Replace the queue with' : 'Load into the queue:'} ${set.title}`}
        >
          {replacesQueue ? 'Replace queue' : 'Load into queue'}
        </button>
        <button
          type="button"
          className="cta-button ghost stims-shell__set-btn"
          onClick={onCopyLink}
          aria-label={`Copy a link to ${set.title}`}
        >
          Copy link
        </button>
        <button
          type="button"
          className="cta-button ghost stims-shell__set-btn stims-shell__set-btn--delete"
          onClick={deleteConfirm.press}
          onBlur={deleteConfirm.disarm}
          data-armed={deleteConfirm.armed ? 'true' : undefined}
          aria-label={
            deleteConfirm.armed
              ? `Delete ${set.title} for good`
              : `Delete ${set.title}`
          }
        >
          {deleteConfirm.armed ? 'Delete for good' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
