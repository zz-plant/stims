import { useState } from 'react';
import styles from '../../css/ParityDiffOverlay.module.css';

type ParityDiffOverlayProps = {
  referenceUrl: string | null;
  onClose?: () => void;
};

export function ParityDiffOverlay({
  referenceUrl,
  onClose,
}: ParityDiffOverlayProps) {
  const [opacity, setOpacity] = useState(0.5);
  const [blendMode, setBlendMode] = useState<'normal' | 'difference'>(
    'difference',
  );

  if (!referenceUrl) return null;

  return (
    <section
      className={styles.overlay}
      aria-label="projectM Reference Diff Overlay"
    >
      <img
        src={referenceUrl}
        alt="projectM Reference"
        className={styles.referenceImage}
        style={{
          opacity,
          mixBlendMode: blendMode,
        }}
      />
      <div className={styles.controls}>
        <span className={styles.badge}>projectM Reference</span>
        <label>
          Opacity: {Math.round(opacity * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(Number.parseFloat(e.target.value))}
            className={styles.slider}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setBlendMode((m) => (m === 'normal' ? 'difference' : 'normal'))
          }
        >
          Blend: {blendMode}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose}>
            ✕
          </button>
        ) : null}
      </div>
    </section>
  );
}
