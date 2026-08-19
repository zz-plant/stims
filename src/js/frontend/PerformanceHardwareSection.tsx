import { useEffect, useRef, useState } from 'react';
import type {
  GlobalLearnState,
  MidiBindingMap,
  MidiDeviceInfo,
} from '../core/services/webmidi-controller.ts';
import { webMidiService } from '../core/services/webmidi-controller.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { describeParameterState } from './parameter-state.ts';

export function PerformanceHardwareSection() {
  const { engineSnapshot } = useEngineSnapshot();
  const activeSource = engineSnapshot?.currentSource ?? '';
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiMessage, setMidiMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>(() =>
    webMidiService.getDevices(),
  );
  const [bindings, setBindings] = useState<Record<string, MidiBindingMap>>(() =>
    webMidiService.getAllBindings(),
  );
  const [learnTarget, setLearnTarget] = useState('');
  const [learning, setLearning] = useState(false);
  const [globalLearn, setGlobalLearn] = useState<GlobalLearnState>(() =>
    webMidiService.getGlobalLearnState(),
  );
  const pendingLearnLabelRef = useRef('');

  useEffect(() => webMidiService.onGlobalLearnChanged(setGlobalLearn), []);

  useEffect(() => {
    // Reused as a general "MIDI state changed" signal (device connect,
    // enable toggle, learned/removed binding) — re-read both slices of
    // state whenever it fires rather than tracking each mutation kind.
    return webMidiService.onDevicesChanged((next) => {
      setDevices(next);
      setBindings(webMidiService.getAllBindings());
      setLearning((wasLearning) => {
        if (wasLearning && webMidiService.getLearnTarget() === null) {
          setMidiMessage(`Mapped a knob to "${pendingLearnLabelRef.current}".`);
          return false;
        }
        return wasLearning;
      });
    });
  }, []);

  const connectMidi = async () => {
    const connected = await webMidiService.initialize();
    setMidiConnected(connected);
    setDevices(webMidiService.getDevices());
    setMidiMessage(
      connected
        ? 'Mapped knobs now change the live preset.'
        : webMidiService.isSupported()
          ? 'MIDI permission was declined. Allow it in your browser to connect a controller.'
          : 'WebMIDI is unavailable in this browser (Safari does not support it).',
    );
  };

  const startLearn = () => {
    const target = learnTarget.trim();
    if (!target) return;
    pendingLearnLabelRef.current = target;
    webMidiService.beginLearn(target);
    setLearning(true);
    setMidiMessage(`Move a knob or fader to map it to "${target}"…`);
  };

  const cancelLearn = () => {
    webMidiService.cancelLearn();
    setLearning(false);
    setMidiMessage(null);
  };

  const globalLearnArmed = globalLearn.phase === 'armed';
  const globalLearnStatus = (() => {
    switch (globalLearn.phase) {
      case 'armed':
        if (globalLearn.target)
          return `Target: ${globalLearn.target} — now move a knob`;
        if (globalLearn.pendingCc)
          return `CC${globalLearn.pendingCc.cc} received — now touch a control`;
        return "Touch a control in the editor's Tune tab or the stage, then move a knob…";
      case 'bound':
        return `Bound CC${globalLearn.cc} → ${globalLearn.target}`;
      default:
        return null;
    }
  })();

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Performance hardware</h3>
      </div>
      <p className="ctl-section__note">
        Connect a class-compliant MIDI controller and learn your own mappings —
        or let Claude drive the show through an MCP session (shows up below as
        "Claude (MCP)").
      </p>

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">MIDI controller</span>
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

      <div className="ctl-midi-devices">
        {devices.map((device) => (
          <MidiDeviceRow
            key={device.id}
            device={device}
            bindings={bindings[device.id] ?? {}}
            activeSource={activeSource}
            onToggleEnabled={(enabled) =>
              webMidiService.setDeviceEnabled(device.id, enabled)
            }
            onRemoveBinding={(cc) => webMidiService.unbindCc(device.id, cc)}
          />
        ))}
      </div>

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Learn from a control</span>
          <span className="ctl-row__hint">
            No typing: arm learn, touch the on-screen control you want (in the
            editor's Tune tab or on the stage), then move a knob — in either
            order.
          </span>
        </span>
        <div className="ctl-midi-learn-row">
          {globalLearnArmed ? (
            <button
              type="button"
              className="ctl-btn"
              onClick={() => webMidiService.cancelGlobalLearn()}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="ctl-btn"
              disabled={!midiConnected}
              onClick={() => webMidiService.armGlobalLearn()}
            >
              Learn from a control
            </button>
          )}
          <span className="ctl-readout" role="status">
            {globalLearnStatus}
          </span>
        </div>
      </div>

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Map a knob by name</span>
          <span className="ctl-row__hint">
            For variables with no control of their own — q1-q8, t1-t8, or
            anything a preset defines. Name it, then move a knob to bind it.
          </span>
          <span className="ctl-row__hint">
            Anything that has a fader, switch or swatch is bound from the
            control itself: open Edit preset code and use its ⏺ button.
          </span>
        </span>
        <div className="ctl-midi-learn-row">
          <input
            type="text"
            className="ctl-midi-learn-input"
            value={learnTarget}
            onChange={(e) => setLearnTarget(e.target.value)}
            placeholder="e.g. zoom, warp, q1"
            disabled={learning}
            aria-label="MIDI learn target name"
          />
          {learning ? (
            <button type="button" className="ctl-btn" onClick={cancelLearn}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="ctl-btn"
              disabled={
                !learnTarget.trim() || !midiConnected || globalLearnArmed
              }
              onClick={startLearn}
            >
              Learn
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MidiDeviceRow({
  device,
  bindings,
  activeSource,
  onToggleEnabled,
  onRemoveBinding,
}: {
  device: MidiDeviceInfo;
  bindings: MidiBindingMap;
  activeSource: string;
  onToggleEnabled: (enabled: boolean) => void;
  onRemoveBinding: (cc: number) => void;
}) {
  const entries = Object.entries(bindings).map(([cc, binding]) => ({
    cc: Number(cc),
    binding,
    // Whether the active preset's own per_frame/per_pixel equations
    // reassign this target every frame, silently overwriting whatever
    // value this binding writes. null = no preset loaded yet, so there's
    // nothing meaningful to report. Shares parameter-state.ts with the
    // performance HUD so the two surfaces cannot disagree about a binding.
    shadowed: activeSource
      ? describeParameterState({
          target: binding.target,
          source: activeSource,
          midiBound: true,
        }).overridden
      : null,
  }));

  return (
    <div className="ctl-midi-device">
      <div className="ctl-row">
        <span className="ctl-row__text">
          <span className="ctl-row__label">{device.name}</span>
          <span className="ctl-row__hint">
            {device.kind === 'virtual'
              ? 'Driven by an MCP session, not physical hardware.'
              : device.state === 'connected'
                ? 'Connected'
                : 'Disconnected — plug it back in to resume.'}
          </span>
        </span>
        <input
          type="checkbox"
          className="ctl-switch"
          checked={device.enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          aria-label={`Enable ${device.name}`}
        />
      </div>
      <div className="ctl-midi-bindings">
        {entries.length === 0 ? (
          <span className="ctl-row__hint">No mappings yet.</span>
        ) : (
          entries.map(({ cc, binding, shadowed }) => (
            <div className="ctl-midi-binding-row" key={cc}>
              {shadowed === null ? null : (
                <span
                  className={`ctl-midi-binding-dot ctl-midi-binding-dot--${shadowed ? 'shadowed' : 'live'}`}
                  title={
                    shadowed
                      ? `${binding.target} is reassigned every frame by this preset's own equations — this binding has no visible effect.`
                      : `${binding.target} isn't touched by the preset's own equations — this binding is live.`
                  }
                />
              )}
              <span className="ctl-readout">CC{cc}</span>
              <span className="ctl-row__hint">{binding.target}</span>
              {shadowed ? (
                <span className="ctl-midi-binding-badge">
                  overridden by preset
                </span>
              ) : null}
              <button
                type="button"
                className="ctl-btn ctl-btn--quiet ctl-btn--icon"
                onClick={() => onRemoveBinding(cc)}
                aria-label={`Remove mapping for CC${cc} (${binding.target})`}
                title="Remove mapping"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
