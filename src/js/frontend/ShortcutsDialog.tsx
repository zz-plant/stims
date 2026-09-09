import type { RefObject } from 'react';
import { Fragment, useEffect, useState } from 'react';
import {
  availableStageKeyDocs,
  availableStageSignalKeys,
  formatStageKey,
} from '../core/unified-input.ts';
import { isMobileDevice } from '../utils/browser/device-detect.ts';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
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
    // Land on the dialog itself rather than the first control inside it, as
    // SidePanel does. Focusing a control scrolled the card to it, so the sheet
    // opened part-way down with its own heading already scrolled off — and a
    // screen reader announced that control instead of the dialog's name.
    initialFocus: 'container',
  });

  useEffect(() => {
    if (open) setOverrides(readShortcutOverrides());
  }, [open]);

  // Escape goes through the shared stack, not this dialog's own backdrop
  // handler. The backdrop only sees keys that originate inside it, so with
  // focus anywhere else the sheet this dialog was opened from took the press
  // instead — closing the sheet and leaving the dialog stranded.
  useEscapeHandler(open, onClose);
  // On phones this dialog is a bottom sheet, and toasts now render above it.
  useBottomOverlaySignal(open);

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
    // The backdrop is the pointer affordance for dismiss. Its keyboard
    // equivalents are Escape, dispatched to the innermost overlay by
    // registerEscapeHandler above, and the Close button inside the card. A
    // keydown handler here would be dead code: focus is trapped in the card,
    // so the backdrop never receives one.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss is Escape, handled above
    <div
      className="stims-shell__shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Shortcuts and gestures"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
      <div
        ref={shortcutsRef}
        className="stims-shell__shortcut-card"
        // Focusable only as a landing spot for the trap's initial focus, so
        // the sheet opens at its heading rather than scrolled to a control.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Suppress everything else from reaching the global shortcut
          // listener — typing a new binding while editing must not also fire
          // the action it is bound to. Escape is deliberately let through, so
          // it reaches the document listener that closes the innermost
          // overlay; this dialog is registered there as long as it is open.
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
