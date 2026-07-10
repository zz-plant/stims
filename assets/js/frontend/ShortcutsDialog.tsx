import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (open) setOverrides(readShortcutOverrides());
  }, [open]);

  useEffect(() => {
    if (!open || !shortcutsRef.current) return;
    const focusable = shortcutsRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();
  }, [open, shortcutsRef]);

  if (!open) return null;

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
    writeShortcutOverrides(next);
    setEditing(null);
    setWarning(null);
  };

  return (
    <div
      className="stims-shell__shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
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
          e.stopPropagation();
          if (e.key === 'Tab' && shortcutsRef.current) {
            const focusable =
              shortcutsRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
        role="presentation"
      >
        <h2>Keyboard shortcuts</h2>
        {warning ? (
          <p className="stims-shell__meta-copy" role="alert">
            {warning}
          </p>
        ) : null}
        <div className="stims-shell__shortcut-grid stims-shell__shortcut-grid--editable">
          {SHORTCUT_REGISTRY.map((shortcut) => (
            <div className="stims-shell__shortcut-row" key={shortcut.id}>
              <kbd>{getShortcutKeys(shortcut.id, overrides).join(' / ')}</kbd>
              <span>{shortcut.label}</span>
              {shortcut.configurable === false ? null : editing ===
                shortcut.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    saveOverride(shortcut.id, String(data.get('keys') ?? ''));
                  }}
                >
                  <input
                    className="stims-shell__input"
                    name="keys"
                    defaultValue={getShortcutKeys(shortcut.id, overrides).join(
                      ', ',
                    )}
                    aria-label={`Shortcut keys for ${shortcut.label}`}
                  />
                  <button type="submit" className="stims-shell__text-button">
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() => setEditing(shortcut.id)}
                >
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="cta-button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
