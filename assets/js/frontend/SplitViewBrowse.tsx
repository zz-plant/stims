import { useCallback, useState } from 'react';
import styles from '../../css/SplitViewBrowse.module.css';
import type { PresetCatalogEntry } from './contracts';
import {
  describePresetMood,
  getPresetCardSupportLabel,
} from './workspace-helpers';
import { PresetArtwork, UiIcon } from './workspace-ui';

type SplitViewBrowseProps = {
  presets: PresetCatalogEntry[];
  currentPresetId: string | null;
  onSelect: (presetId: string) => void;
  onClose: () => void;
  onPlay: (presetId: string) => void;
};

export function SplitViewBrowse({
  presets,
  currentPresetId,
  onSelect,
  onClose,
  onPlay,
}: SplitViewBrowseProps) {
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(
    currentPresetId,
  );
  const selectedPreset = presets.find((p) => p.id === previewPresetId);

  const handleSelect = useCallback(
    (presetId: string) => {
      setPreviewPresetId(presetId);
      onSelect(presetId);
    },
    [onSelect],
  );

  return (
    <aside
      className={styles.splitView}
      role="dialog"
      aria-modal="true"
      aria-label="Browse presets"
    >
      <div className={styles.listPanel}>
        <div className={styles.listPanelHeader}>
          <h2 className={styles.listPanelTitle}>Browse presets</h2>
          <button
            type="button"
            className={styles.previewPlay}
            onClick={onClose}
          >
            <UiIcon
              name="close"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>
        <div className={styles.listPanelBody}>
          <ul
            className="stims-shell__preset-list"
            style={{ maxHeight: 'none', overflow: 'visible' }}
          >
            {presets.map((entry) => {
              const supportLabel = getPresetCardSupportLabel(entry);

              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="stims-shell__preset-card"
                    data-active={String(entry.id === previewPresetId)}
                    onClick={() => handleSelect(entry.id)}
                  >
                    <PresetArtwork entry={entry} compact />
                    <span className="stims-shell__preset-card-copy">
                      <span className="stims-shell__preset-title">
                        {entry.title}
                      </span>
                      <span className="stims-shell__preset-vibe">
                        {describePresetMood(entry)}
                      </span>
                      <span className="stims-shell__preset-meta-row">
                        <span className="stims-shell__preset-meta">
                          {entry.author || 'Unknown author'}
                        </span>
                        {supportLabel ? (
                          <span className="stims-shell__preset-tech">
                            {supportLabel}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className={styles.previewPanel}>
        {selectedPreset ? (
          <>
            <div className={styles.previewHeader}>
              <div className={styles.previewMeta}>
                <span className={styles.previewMetaTitle}>
                  {selectedPreset.title}
                </span>
                <span className={styles.previewMetaAuthor}>
                  {selectedPreset.author || 'Unknown author'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={styles.previewMood}>
                  {describePresetMood(selectedPreset)}
                </span>
                <button
                  type="button"
                  className={styles.previewPlay}
                  onClick={() => onPlay(selectedPreset.id)}
                >
                  Play now
                </button>
              </div>
            </div>
            <div className={styles.previewStage}>
              <iframe
                className={styles.previewIframe}
                src={`/?agent=true&preset=${encodeURIComponent(selectedPreset.id)}&embedded=true`}
                title={`Preview: ${selectedPreset.title}`}
                allow="autoplay"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </>
        ) : (
          <div className={styles.previewEmpty}>
            <p>Select a preset from the list to see a live preview here.</p>
            <p>
              Press <strong>Play now</strong> to open it on the full stage.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
