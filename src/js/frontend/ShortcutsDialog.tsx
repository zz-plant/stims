import type { RefObject } from 'react';
import { Fragment, useEffect, useState } from 'react';
import {
  availableStageKeyDocs,
  availableStageSignalKeys,
  formatStageKey,
} from '../core/unified-input.ts';
import { isMobileDevice } from '../utils/browser/device-detect.ts';
import { useFocusTrap } from './hooks/use-focus-trap.ts';
import { STAGE_GESTURES } from './hooks/useStageGesture.ts';
import {
  getShortcutKeys,
  readShortcutOverrides,
  SHORTCUT_REGISTRY,
  type ShortcutActionId,
  type ShortcutOverrides,
  writeShortcutOverrides,
} from './shortcut-registry.ts';

export function ShortcutsDialog({
  open,
  onClose,
  shortcutsRef,
}: {
  open: boolean;
  onClose: () => void;
  shortcutsRef: RefObject<HTMLDivElement | null>;
}) {
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});
  const [editing, setEditing] = useState<ShortcutActionId | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useFocusTrap({
    active: open,
    autoFocus: true,
    restoreFocusOnUnmount: true,
    externalContainerRef: shortcutsRef,
  });

  useEffect(() => {
    if (open) setOverrides(readShortcutOverrides());
  }, [open]);

  if (!open) return null;

  // On touch there is no keyboard to shortcut with, and the gestures are the
  // only way to drive the stage — so they lead. Deciding by device rather
  // than by input event keeps the order stable while the dialog is open.
  const touchFirst = isMobileDevice();
  const stageKeys = availableStageKeyDocs();
  const signalKeys = availableStageSignalKeys();

  const saveOverride = (actionId: ShortcutActionId, rawValue: string) => {
    const def = SHORTCUT_REGISTRY.find((entry) => entry.id === actionId);
    if (!def?.configurable && def?.configurable !== undefined) return;
    const keys = rawValue
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    const normalized = keys.map((key) => key.toLowerCase());
    const conflict = SHORTCUT_REGISTRY.find(
      (entry) =>
        entry.id !== actionId &&
        getShortcutKeys(entry.id, overrides).some((key) =>
          normalized.includes(key.toLowerCase()),
        ),
    );
    if (conflict) {
      setWarning(
        `Shortcut already used by ${conflict.label}. Choose another key.`,
      );
      return;
    }
    const next = { ...overrides, [actionId]: keys };
    setOverrides(next);
    setEditing(null);
    if (writeShortcutOverrides(next)) {
      setWarning(null);
    } else {
      setWarning(
        'Shortcut updated for this session, but could not be saved for next time.',
      );
    }
  };

  return (
    <div
      className="stims-shell__shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Shortcuts and gestures"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
      <div
        ref={shortcutsRef}
        className="stims-shell__shortcut-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Suppress everything else from reaching the global shortcut
          // listener (typing a new binding while editing shouldn't also
          // trigger it), but let Escape bubble to the backdrop's close
          // handler above — otherwise the dialog that documents "Esc
          // closes" is the one dialog Esc can't close, since focus is
          // trapped inside this card the entire time it's open.
          if (e.key !== 'Escape') {
            e.stopPropagation();
          }
        }}
        role="presentation"
      >
        <h2>Shortcuts &amp; gestures</h2>
        {warning ? (
          <p className="stims-shell__meta-copy" role="alert">
            {warning}
          </p>
        ) : null}
        {(touchFirst
          ? (['gestures', 'stage', 'keyboard'] as const)
          : (['keyboard', 'stage', 'gestures'] as const)
        ).map((section) => {
          if (section === 'keyboard') {
            return (
              <section key={section}>
                <h3>Keyboard</h3>
                <div className="stims-shell__shortcut-grid stims-shell__shortcut-grid--editable">
                  {SHORTCUT_REGISTRY.map((shortcut) => (
                    <div
                      className="stims-shell__shortcut-row"
                      key={shortcut.id}
                    >
                      <kbd>
                        {getShortcutKeys(shortcut.id, overrides).join(' / ')}
                      </kbd>
                      <span>{shortcut.label}</span>
                      {shortcut.configurable === false ? null : editing ===
                        shortcut.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = event.currentTarget;
                            const data = new FormData(form);
                            saveOverride(
                              shortcut.id,
                              String(data.get('keys') ?? ''),
                            );
                          }}
                        >
                          <input
                            className="stims-shell__input"
                            name="keys"
                            defaultValue={getShortcutKeys(
                              shortcut.id,
                              overrides,
                            ).join(', ')}
                            aria-label={`Shortcut keys for ${shortcut.label}`}
                          />
                          <button
                            type="submit"
                            className="stims-shell__text-button"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="stims-shell__text-button"
                          aria-label={`Edit shortcut for ${shortcut.label}`}
                          onClick={() => setEditing(shortcut.id)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          }
          if (section === 'gestures') {
            return (
              <section key={section}>
                <h3>Stage gestures</h3>
                <div className="stims-shell__shortcut-grid">
                  {STAGE_GESTURES.map((entry) => (
                    <Fragment key={entry.gesture}>
                      <kbd>{entry.gesture}</kbd>
                      <span>{entry.label}</span>
                    </Fragment>
                  ))}
                </div>
              </section>
            );
          }
          if (stageKeys.length === 0) return null;
          return (
            <section key={section}>
              <h3>On the stage</h3>
              <p className="stims-shell__meta-copy">
                Click the visuals first, then drag them around — these keys
                belong to the stage, not the app.
              </p>
              <div className="stims-shell__shortcut-grid">
                {stageKeys.map((entry) => (
                  <Fragment key={entry.label}>
                    <span className="stims-shell__shortcut-keys">
                      {entry.keys.map((key) => (
                        <kbd key={key}>{formatStageKey(key, entry.shift)}</kbd>
                      ))}
                    </span>
                    <span>{entry.label}</span>
                  </Fragment>
                ))}
              </div>
              {signalKeys.length > 0 ? (
                <p className="stims-shell__meta-copy">
                  The stage also passes{' '}
                  {signalKeys.map((key) => formatStageKey(key)).join(' ')}{' '}
                  straight to the playing preset. No bundled preset reads them
                  yet — one you write or generate can.
                </p>
              ) : null}
            </section>
          );
        })}
        <button type="button" className="cta-button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
