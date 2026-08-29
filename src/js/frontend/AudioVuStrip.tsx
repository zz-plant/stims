import { useEffect, useState, useSyncExternalStore } from 'react';
import styles from '../../css/AudioVuStrip.module.css';
import {
  getAudioBands,
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';

export function AudioVuStrip() {
  const energy = useSyncExternalStore(
    subscribeAudioEnergy,
    getAudioEnergy,
    getAudioEnergy,
  );
  const bands = useSyncExternalStore(
    subscribeAudioEnergy,
    getAudioBands,
    getAudioBands,
  );

  const [peakBass, setPeakBass] = useState(0);
  const [peakMid, setPeakMid] = useState(0);
  const [peakTreble, setPeakTreble] = useState(0);

  useEffect(() => {
    if (bands.bass > peakBass) setPeakBass(bands.bass);
    else {
      const timer = setTimeout(
        () => setPeakBass((p) => Math.max(0, p * 0.95)),
        50,
      );
      return () => clearTimeout(timer);
    }
  }, [bands.bass, peakBass]);

  useEffect(() => {
    if (bands.mid > peakMid) setPeakMid(bands.mid);
    else {
      const timer = setTimeout(
        () => setPeakMid((p) => Math.max(0, p * 0.95)),
        50,
      );
      return () => clearTimeout(timer);
    }
  }, [bands.mid, peakMid]);

  useEffect(() => {
    if (bands.treble > peakTreble) setPeakTreble(bands.treble);
    else {
      const timer = setTimeout(
        () => setPeakTreble((p) => Math.max(0, p * 0.95)),
        50,
      );
      return () => clearTimeout(timer);
    }
  }, [bands.treble, peakTreble]);

  const normBass = Math.min(100, Math.round(bands.bass * 50));
  const normMid = Math.min(100, Math.round(bands.mid * 50));
  const normTreb = Math.min(100, Math.round(bands.treble * 50));
  const normEnergy = Math.min(100, Math.round(energy * 100));

  return (
    <section className={styles.strip} aria-label="Live Audio VU Meter">
      <div
        className={styles.masterMeter}
        title={`Overall Energy: ${normEnergy}%`}
      >
        <span className={styles.label}>ENERGY</span>
        <div className={styles.meterTrack}>
          <div
            className={styles.meterFillMaster}
            style={{ width: `${normEnergy}%` }}
          />
        </div>
      </div>

      <div className={styles.bandMeters}>
        <div className={styles.band} title={`Bass: ${normBass}%`}>
          <span className={styles.bandLabel}>BASS</span>
          <div className={styles.meterTrack}>
            <div
              className={styles.meterFillBass}
              style={{ width: `${normBass}%` }}
            />
            <div
              className={styles.peakMarker}
              style={{ left: `${Math.min(100, Math.round(peakBass * 50))}%` }}
            />
          </div>
        </div>

        <div className={styles.band} title={`Mid: ${normMid}%`}>
          <span className={styles.bandLabel}>MID</span>
          <div className={styles.meterTrack}>
            <div
              className={styles.meterFillMid}
              style={{ width: `${normMid}%` }}
            />
            <div
              className={styles.peakMarker}
              style={{ left: `${Math.min(100, Math.round(peakMid * 50))}%` }}
            />
          </div>
        </div>

        <div className={styles.band} title={`Treble: ${normTreb}%`}>
          <span className={styles.bandLabel}>TREB</span>
          <div className={styles.meterTrack}>
            <div
              className={styles.meterFillTreb}
              style={{ width: `${normTreb}%` }}
            />
            <div
              className={styles.peakMarker}
              style={{ left: `${Math.min(100, Math.round(peakTreble * 50))}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
