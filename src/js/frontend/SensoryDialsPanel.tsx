import { useEffect, useState } from 'react';
import {
  getSensoryMoodKnobs,
  type SensoryMoodKnobs,
  setSensoryMoodKnobs,
} from '../core/services/sensory-translation.ts';

export function SensoryDialsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [knobs, setKnobs] = useState<SensoryMoodKnobs>(() =>
    getSensoryMoodKnobs(),
  );

  useEffect(() => {
    if (!open) return;
    setKnobs(getSensoryMoodKnobs());
  }, [open]);

  if (!open) return null;

  const update = (partial: Partial<SensoryMoodKnobs>) => {
    const next = setSensoryMoodKnobs(partial);
    setKnobs(next);
  };

  return (
    <section
      role="dialog"
      aria-label="Sensory mood dials"
      className="stims-sensory-dials"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header>
        <h2>Sensory mood dials</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sensory dials"
        >
          Close
        </button>
      </header>

      <label>
        Sensory overload ceiling
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={knobs.overloadCeiling}
          onChange={(e) => update({ overloadCeiling: Number(e.target.value) })}
          aria-label="Sensory overload ceiling"
        />
        <span>{knobs.overloadCeiling.toFixed(2)}</span>
      </label>

      <label>
        Harmonic predictability
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={knobs.predictability}
          onChange={(e) => update({ predictability: Number(e.target.value) })}
          aria-label="Harmonic predictability"
        />
        <span>{knobs.predictability.toFixed(2)}</span>
      </label>

      <label>
        Breathing cadence (seconds)
        <input
          type="range"
          min={4}
          max={12}
          step={0.5}
          value={knobs.breathingCadenceSeconds ?? 6}
          onChange={(e) =>
            update({ breathingCadenceSeconds: Number(e.target.value) })
          }
          aria-label="Breathing cadence seconds"
        />
        <span>{(knobs.breathingCadenceSeconds ?? 6).toFixed(1)}s</span>
      </label>

      <p>Smooths rapid motion. Locks visual pulse to a breathing rhythm.</p>
    </section>
  );
}
