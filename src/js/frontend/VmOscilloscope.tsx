import styles from '../../css/VmOscilloscope.module.css';
import { useEngineSnapshot } from './workspace-context.tsx';

export function VmOscilloscope() {
  const { engineSnapshot } = useEngineSnapshot();
  const sessionState = engineSnapshot?.sessionState;
  const numericFields = sessionState?.preset?.compiled?.numericFields ?? {};
  const tempoBpm = engineSnapshot?.tempoBpm
    ? `${engineSnapshot.tempoBpm} BPM`
    : '—';
  const backend = engineSnapshot?.backend ?? 'webgl';

  const trackedVars = [
    { name: 'backend', val: backend },
    { name: 'tempo', val: tempoBpm },
    { name: 'zoom', val: (numericFields.zoom ?? 1).toFixed(3) },
    { name: 'warp', val: (numericFields.warp ?? 0).toFixed(3) },
    { name: 'rot', val: (numericFields.rot ?? 0).toFixed(3) },
    { name: 'decay', val: (numericFields.decay ?? 0.98).toFixed(3) },
    { name: 'dx', val: (numericFields.dx ?? 0).toFixed(3) },
    { name: 'dy', val: (numericFields.dy ?? 0).toFixed(3) },
  ];

  return (
    <section
      className={styles.container}
      aria-label="VM Variables Oscilloscope"
    >
      <span className={styles.title}>VM OSC</span>
      {trackedVars.map(({ name, val }) => (
        <div key={name} className={styles.varPill}>
          <span className={styles.varName}>{name}:</span>
          <span className={styles.varValue}>{val}</span>
        </div>
      ))}
    </section>
  );
}
