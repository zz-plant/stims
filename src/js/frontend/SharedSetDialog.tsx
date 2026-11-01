import type { RefObject } from 'react';
import { useMemo, useRef, useState } from 'react';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import type { SharedPresetSetPayload } from './preset-sets.ts';

export function SharedSetDialog({
  open,
  onClose,
  payload,
  catalog,
  existingQueueCount,
  onLoadQueue,
  onSaveSet,
}: {
  open: boolean;
  onClose: () => void;
  payload: SharedPresetSetPayload | null;
  catalog: PresetCatalogEntry[];
  existingQueueCount: number;
  onLoadQueue: (presetIds: string[]) => void;
  onSaveSet: (title: string, presetIds: string[]) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [savedPayload, setSavedPayload] =
    useState<SharedPresetSetPayload | null>(null);
  const savedLocally = payload !== null && savedPayload === payload;

  useFocusTrap({
    active: open,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: dialogRef as RefObject<HTMLDivElement | null>,
    initialFocus: 'container',
  });

  useEscapeHandler(open, onClose);
  useBottomOverlaySignal(open);

  const resolvedPresets = useMemo(() => {
    if (!payload) return [];
    const catalogMap = new Map<string, PresetCatalogEntry>();
    for (const entry of catalog) {
      catalogMap.set(entry.id, entry);
    }
    return payload.presets.map((id) => {
      const entry = catalogMap.get(id);
      return {
        id,
        entry: entry ?? null,
        display: entry ? splitPresetDisplay(entry.title || entry.id) : null,
      };
    });
  }, [catalog, payload]);

  if (!open || !payload) return null;

  const validIds = resolvedPresets
    .filter((p) => Boolean(p.entry))
    .map((p) => p.id);
  const missingCount = resolvedPresets.length - validIds.length;

  const handleLoad = () => {
    onLoadQueue(validIds);
    onClose();
  };

  const handleSave = () => {
    onSaveSet(payload.title, validIds);
    setSavedPayload(payload);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handles keyboard dismiss
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click dismiss
    <div className="stims-shell__credits-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="stims-shell__credits-card stims-shell__credits-card--narrow"
        data-shell-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-label={`Shared Preset Set: ${payload.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
      >
        <div className="stims-shell__dialog-head stims-shell__dialog-head--bordered">
          <h2 className="stims-shell__dialog-title">{payload.title}</h2>
          <p className="stims-shell__dialog-subtitle">
            Shared preset set · {resolvedPresets.length}{' '}
            {resolvedPresets.length === 1 ? 'preset' : 'presets'}
            {missingCount > 0
              ? ` (${validIds.length} available in this catalog)`
              : ''}
          </p>
        </div>

        {existingQueueCount > 0 ? (
          <div className="stims-shell__set-warning">
            Loading this set will replace your current queue (
            {existingQueueCount}{' '}
            {existingQueueCount === 1 ? 'preset' : 'presets'}).
          </div>
        ) : null}

        <div className="stims-shell__set-list stims-shell__set-list--shared">
          {resolvedPresets.map(({ id, entry, display }, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: preset set items may contain duplicate preset IDs in sequence
              key={`${id}-${index}`}
              className="stims-shell__set-row stims-shell__set-row--shared"
            >
              <span className="stims-shell__set-index">{index + 1}.</span>
              <div className="stims-shell__set-meta">
                {entry && display ? (
                  <>
                    <div className="stims-shell__set-title">
                      {display.title}
                    </div>
                    {display.byline ? (
                      <div className="stims-shell__set-sub">
                        {display.byline}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="stims-shell__set-unavailable">
                    {id}{' '}
                    <span className="stims-shell__set-unavailable-tag">
                      (unavailable)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="stims-shell__dialog-footer">
          <button type="button" className="cta-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cta-button secondary"
            onClick={handleSave}
            disabled={savedLocally || validIds.length === 0}
          >
            {savedLocally ? 'Saved to sets ✓' : 'Save to my sets'}
          </button>
          <button
            type="button"
            className="cta-button primary"
            onClick={handleLoad}
            disabled={validIds.length === 0}
            data-action="load-shared-set"
          >
            Load into queue
          </button>
        </div>
      </div>
    </div>
  );
}
