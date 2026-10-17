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
  const [savedLocally, setSavedLocally] = useState(false);

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
    setSavedLocally(true);
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
        aria-label={`Shared Preset Set: ${payload.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
        style={{ maxWidth: '480px', width: '92vw' }}
      >
        <div
          style={{
            padding: '4px 0 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <h2
            style={{ margin: '0 0 4px', fontSize: '1.25rem', fontWeight: 600 }}
          >
            {payload.title}
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>
            Shared preset set · {resolvedPresets.length}{' '}
            {resolvedPresets.length === 1 ? 'preset' : 'presets'}
            {missingCount > 0
              ? ` (${validIds.length} available in this catalog)`
              : ''}
          </p>
        </div>

        {existingQueueCount > 0 ? (
          <div
            style={{
              margin: '12px 0',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(255, 180, 0, 0.12)',
              border: '1px solid rgba(255, 180, 0, 0.3)',
              fontSize: '0.85rem',
            }}
          >
            Loading this set will replace your current queue (
            {existingQueueCount}{' '}
            {existingQueueCount === 1 ? 'preset' : 'presets'}).
          </div>
        ) : null}

        <div
          style={{
            maxHeight: '240px',
            overflowY: 'auto',
            margin: '12px 0',
            paddingRight: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {resolvedPresets.map(({ id, entry, display }, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: preset set items may contain duplicate preset IDs in sequence
              key={`${id}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              <span
                style={{
                  opacity: 0.5,
                  fontVariantNumeric: 'tabular-nums',
                  width: '20px',
                }}
              >
                {index + 1}.
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {entry && display ? (
                  <>
                    <div
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {display.title}
                    </div>
                    {display.byline ? (
                      <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                        {display.byline}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ opacity: 0.5 }}>
                    {id}{' '}
                    <span
                      style={{ fontSize: '0.75rem', color: 'var(--stims-bad)' }}
                    >
                      (unavailable)
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            marginTop: '16px',
          }}
        >
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
