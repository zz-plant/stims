import { useEffect, useState } from 'react';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import { webXrStageService } from '../core/services/webxr-stage-session.ts';
import { bindMidiToMilkdropControls } from './performance-hardware-controls.ts';
import { useEngine, useEngineSnapshot } from './workspace-context.tsx';

export function PerformanceHardwareSection() {
  const engine = useEngine();
  const { engineSnapshot } = useEngineSnapshot();
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiMessage, setMidiMessage] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [xrActive, setXrActive] = useState(webXrStageService.isSessionActive());
  const [xrMessage, setXrMessage] = useState<string | null>(null);

  useEffect(
    () =>
      bindMidiToMilkdropControls(webMidiService, (target, value) => {
        engine.updateInspectorField(target, value);
        setMidiMessage(`${target} ${value.toFixed(2)}`);
      }),
    [engine],
  );

  useEffect(() => {
    let disposed = false;
    void webXrStageService.checkCapabilities().then((capabilities) => {
      if (!disposed) setXrSupported(capabilities.vrSupported);
    });
    const unsubscribe = webXrStageService.onSessionChange(setXrActive);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const connectMidi = async () => {
    const connected = await webMidiService.initialize();
    setMidiConnected(connected);
    setMidiMessage(
      connected
        ? 'Mapped knobs now change the live preset.'
        : 'WebMIDI is unavailable or permission was declined.',
    );
  };

  const toggleXr = async () => {
    setXrMessage(null);
    if (xrActive) {
      await engine.endXrStage();
      return;
    }
    const started = await engine.startXrStage('immersive-vr');
    if (!started) {
      setXrMessage('The active renderer could not start an immersive session.');
    }
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
            CC 1–4 control zoom, warp, rotation, and decay. CC 7–10 control
            q1–q4 on the live preset.
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

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Immersive stage</span>
          <span className="ctl-row__hint">
            Presents the active audio-reactive scene through the renderer's
            WebXR camera. A headset and secure browser context are required.
          </span>
        </span>
        <button
          type="button"
          className="ctl-btn"
          disabled={
            !xrActive && (!xrSupported || !engineSnapshot?.runtimeReady)
          }
          onClick={() => void toggleXr()}
        >
          {xrActive ? 'Exit VR stage' : 'Enter VR stage'}
        </button>
        {xrMessage ? (
          <span className="ctl-readout" role="status">
            {xrMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}
