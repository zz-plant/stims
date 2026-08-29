import { useEffect, useState } from 'react';
import styles from '../../css/RadioJourneyControls.module.css';
import { useWorkspace } from './workspace-context.tsx';

export type JourneyMode = 'timed' | 'energy-peak' | 'artist-chain';

export function RadioJourneyControls() {
  const { engine } = useWorkspace();
  const [active, setActive] = useState(false);
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('timed');
  const [intervalSec] = useState(25);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      // Trigger smooth next preset transition
      engine.handleShufflePreset?.();
    }, intervalSec * 1000);

    return () => clearInterval(timer);
  }, [active, intervalSec, engine]);

  return (
    <section className={styles.container} aria-label="Smart Radio Journey">
      <button
        type="button"
        className={active ? styles.radioActive : undefined}
        onClick={() => setActive((a) => !a)}
        aria-pressed={active}
      >
        {active ? (
          <>
            <span className={styles.radioIndicator} />
            Radio ON ({intervalSec}s)
          </>
        ) : (
          'Start Radio Journey'
        )}
      </button>

      {active && (
        <select
          value={journeyMode}
          onChange={(e) => setJourneyMode(e.target.value as JourneyMode)}
          className={styles.modeSelect}
          aria-label="Journey Mode"
        >
          <option value="timed">Timed Shift (25s)</option>
          <option value="energy-peak">Energy Drop Shift</option>
          <option value="artist-chain">Artist Continuum</option>
        </select>
      )}
    </section>
  );
}
