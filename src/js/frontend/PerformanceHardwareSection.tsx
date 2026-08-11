import { useEffect, useState } from 'react';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import { bindMidiToMilkdropControls } from './performance-hardware-controls.ts';
import { useEngine } from './workspace-context.tsx';

export function PerformanceHardwareSection() {
  const engine = useEngine();
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiMessage, setMidiMessage] = useState<string | null>(null);

  useEffect(
    () =>
      bindMidiToMilkdropControls(webMidiService, (target, value) => {
        engine.updateInspectorField(target, value);
        setMidiMessage(`${target} ${value.toFixed(2)}`);
      }),
    [engine],
  );

  const connectMidi = async () => {
    const connected = await webMidiService.initialize();
    setMidiConnected(connected);
    setMidiMessage(
      connected
        ? 'Mapped knobs now change the live preset.'
        : 'WebMIDI is unavailable or permission was declined.',
    );
  };

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Performance hardware</h3>
      </div>

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">MIDI controller</span>
          <span className="ctl-row__hint">
            Connect a class-compliant MIDI controller to drive the visuals live:
            the first four knobs control zoom, warp, rotation, and decay, and
            the next four control the current preset's custom variables.
          </span>
        </span>
        <button
          type="button"
          className="ctl-btn"
          disabled={!webMidiService.isSupported() || midiConnected}
          onClick={() => void connectMidi()}
        >
          {midiConnected ? 'MIDI connected' : 'Connect MIDI controller'}
        </button>
        {midiMessage ? (
          <span className="ctl-readout" role="status">
            {midiMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}
