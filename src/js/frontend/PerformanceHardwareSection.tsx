/**
 * Settings → Performance hardware: connecting a controller and mapping it.
 *
 * Four ways to map, one per thing a performer reaches for: touch an on-screen
 * control and move a knob (global learn), name a variable and move a knob,
 * pick a command and hit a pad, or take a known controller's factory
 * profile, which arrives on its own. Every mapping lands in the MIDI
 * service's per-device record and is listed here under its device with a
 * remove button, so nothing a learn did is invisible.
 *
 * The live wiring from a controller to the stage is not here. It lives at
 * the shell for the app's lifetime (hooks/use-performance-hardware.ts), so a
 * controller keeps working after this panel closes.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  GlobalLearnState,
  MidiBindingMap,
  MidiDeviceInfo,
  MidiNoteBindingMap,
} from '../core/services/webmidi-controller.ts';
import {
  VIRTUAL_GAMEPAD_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import type { CommandAction } from './command-palette-registry.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { padActionIdOf, padActionTarget } from './midi-pad-actions.ts';
import { describeParameterState } from './parameter-state.ts';

/** The slice of a palette action a pad picker shows. */
export type PadActionChoice = Pick<CommandAction, 'id' | 'label' | 'group'>;

/** The first command offered, because it is the one a pad is most often for. */
const DEFAULT_PAD_ACTION = 'next-preset';

/**
 * What a note binding does, in words: the command's palette label, or the
 * field it drives. A command this build no longer has is shown by its id
 * rather than hidden, so the performer can see the pad and remove it.
 */
function describeNoteTarget(
  target: string,
  actions: readonly PadActionChoice[],
): string {
  const actionId = padActionIdOf(target);
  if (actionId === null) return target;
  return actions.find((action) => action.id === actionId)?.label ?? actionId;
}

/** Palette groups in the order the palette lists them. */
function groupChoices(actions: readonly PadActionChoice[]) {
  const groups = new Map<string, PadActionChoice[]>();
  for (const action of actions) {
    const group = action.group ?? 'Other';
    const members = groups.get(group) ?? [];
    members.push(action);
    groups.set(group, members);
  }
  return [...groups];
}

const NO_MIDI_REASON = 'Connect a MIDI controller to map knobs.';

export function PerformanceHardwareSection({
  padActions = [],
}: {
  /** Commands a pad can be mapped to: the command palette's own list. */
  padActions?: readonly PadActionChoice[];
} = {}) {
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
  const [noteBindings, setNoteBindings] = useState<
    Record<string, MidiNoteBindingMap>
  >(() => webMidiService.getAllNoteBindings());
  const [padAction, setPadAction] = useState(() =>
    padActions.some((action) => action.id === DEFAULT_PAD_ACTION)
      ? DEFAULT_PAD_ACTION
      : (padActions[0]?.id ?? ''),
  );
  const [padLearning, setPadLearning] = useState(
    () => webMidiService.getNoteLearnTarget() !== null,
  );
  const pendingPadLabelRef = useRef('');
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
      setNoteBindings(webMidiService.getAllNoteBindings());
      setLearning((wasLearning) => {
        if (wasLearning && webMidiService.getLearnTarget() === null) {
          setMidiMessage(`Mapped a knob to "${pendingLearnLabelRef.current}".`);
          return false;
        }
        return wasLearning;
      });
      setPadLearning((wasLearning) => {
        if (wasLearning && webMidiService.getNoteLearnTarget() === null) {
          setMidiMessage(
            `Mapped a pad to "${pendingPadLabelRef.current}". Hit it to run it.`,
          );
          return false;
        }
        return wasLearning;
      });
    });
  }, []);

  // Closing Settings mid-learn would otherwise leave the next pad hit, made
  // in the middle of a set, silently rebinding a pad.
  useEffect(() => () => webMidiService.cancelNoteLearn(), []);

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

  const startPadLearn = () => {
    if (!padAction) return;
    pendingPadLabelRef.current = describeNoteTarget(
      padActionTarget(padAction),
      padActions,
    );
    webMidiService.beginNoteLearn(padActionTarget(padAction));
    setPadLearning(true);
    setMidiMessage(
      `Hit a pad, key or gamepad button to map it to "${pendingPadLabelRef.current}"…`,
    );
  };

  const cancelPadLearn = () => {
    webMidiService.cancelNoteLearn();
    setPadLearning(false);
    setMidiMessage(null);
  };

  const globalLearnArmed = globalLearn.phase === 'armed';
  const knobLearnBlocked = !midiConnected
    ? NO_MIDI_REASON
    : globalLearnArmed
      ? 'Finish or cancel the mapping above first.'
      : !learnTarget.trim()
        ? 'Type a name first.'
        : null;
  const globalLearnStatus = (() => {
    switch (globalLearn.phase) {
      case 'armed':
        if (globalLearn.target)
          return `Target: ${globalLearn.target}. Now move a knob`;
        if (globalLearn.pendingCc)
          return `Knob ${globalLearn.pendingCc.cc} moved. Now touch a control`;
        return "Touch a control in the editor's Tune tab or the stage, then move a knob…";
      case 'bound':
        return `Knob ${globalLearn.cc} now moves ${globalLearn.target}`;
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
        Connect a MIDI controller that needs no driver and map its knobs, or let
        Claude drive the show through an MCP session (shows up below as "Claude
        (MCP)").
      </p>
      {/* A gamepad has arrived here as a device since the performance source
          shipped, but the copy named only MIDI and Claude, so the one piece
          of hardware most people already own read as unsupported. */}
      <p className="ctl-section__note">
        A game controller counts too, with nothing to connect: plug one in and
        it appears below as "Gamepad", sticks and triggers already mapped. Known
        controllers (nanoKONTROL2, Launch Control XL, MiniLab 3) arrive with
        their factory mapping instead of the generic one.
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
            noteBindings={noteBindings[device.id] ?? {}}
            padActions={padActions}
            activeSource={activeSource}
            onToggleEnabled={(enabled) =>
              webMidiService.setDeviceEnabled(device.id, enabled)
            }
            onRemoveBinding={(cc) => webMidiService.unbindCc(device.id, cc)}
            onRemoveNoteBinding={(note) =>
              webMidiService.unbindNote(device.id, note)
            }
          />
        ))}
      </div>

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Learn from a control</span>
          <span className="ctl-row__hint">
            No typing: arm learn, touch the on-screen control you want (in the
            editor's Tune tab or on the stage), then move a knob, in either
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
              Map a knob to a control
            </button>
          )}
          <span className="ctl-readout" role="status">
            {globalLearnStatus ?? (midiConnected ? null : NO_MIDI_REASON)}
          </span>
        </div>
      </div>

      {padActions.length > 0 ? (
        <div className="ctl-row ctl-row--stack">
          <span className="ctl-row__text">
            <span className="ctl-row__label">Map a pad to a command</span>
            <span className="ctl-row__hint">
              Pick a command, press Learn, then hit a pad, key or gamepad
              button. That first hit only maps it; every hit after runs the
              command.
            </span>
          </span>
          <div className="ctl-midi-learn-row">
            <select
              className="ctl-select"
              value={padAction}
              onChange={(event) => setPadAction(event.target.value)}
              disabled={padLearning}
              aria-label="Command to map to a pad"
            >
              {groupChoices(padActions).map(([group, members]) => (
                <optgroup key={group} label={group}>
                  {members.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {padLearning ? (
              <button
                type="button"
                className="ctl-btn"
                onClick={cancelPadLearn}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="ctl-btn"
                disabled={!padAction}
                onClick={startPadLearn}
              >
                Map the next pad I hit
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="ctl-row ctl-row--stack">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Map a knob by name</span>
          <span className="ctl-row__hint">
            For variables with no control of their own: q1–q8, t1–t8, or
            anything a preset defines. Name it, then move a knob to bind it.
          </span>
          <span className="ctl-row__hint">
            Anything that has a fader, switch, or swatch is bound from the
            control itself: open Edit preset code and use its ⏺ button.
          </span>
        </span>
        <div className="ctl-midi-learn-row">
          <input
            type="text"
            className="ctl-midi-learn-input"
            value={learnTarget}
            onChange={(e) => setLearnTarget(e.target.value)}
            placeholder="e.g., zoom, warp, q1"
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
              disabled={knobLearnBlocked !== null}
              onClick={startLearn}
            >
              Map the next knob I move
            </button>
          )}
        </div>
        {/* A greyed-out button said nothing about why. */}
        {knobLearnBlocked && !learning ? (
          <span className="ctl-readout">{knobLearnBlocked}</span>
        ) : null}
      </div>
    </section>
  );
}

function MidiDeviceRow({
  device,
  bindings,
  noteBindings,
  padActions,
  activeSource,
  onToggleEnabled,
  onRemoveBinding,
  onRemoveNoteBinding,
}: {
  device: MidiDeviceInfo;
  bindings: MidiBindingMap;
  noteBindings: MidiNoteBindingMap;
  padActions: readonly PadActionChoice[];
  activeSource: string;
  onToggleEnabled: (enabled: boolean) => void;
  onRemoveBinding: (cc: number) => void;
  onRemoveNoteBinding: (note: number) => void;
}) {
  const noteEntries = Object.entries(noteBindings).map(([note, binding]) => ({
    note: Number(note),
    label: describeNoteTarget(binding.target, padActions),
  }));
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
            {/* Both virtual devices used to share Claude's description, so a
                gamepad row told the user it was "driven by an MCP session" —
                the one sentence guaranteed to make someone stop looking.

                This row is listed on every machine, because the gamepad is a
                virtual device and those are hardcoded to `connected`. So the
                copy describes what the row is for and does not assert that a
                pad is plugged in: "A connected game controller" told everyone
                with no controller at all that they had one. */}
            {device.id === VIRTUAL_GAMEPAD_DEVICE_ID
              ? 'Game controller sticks and triggers, mapped like a MIDI device. Plug one in and move a stick to use it.'
              : device.kind === 'virtual'
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
        {entries.length === 0 && noteEntries.length === 0 ? (
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
        {noteEntries.map(({ note, label }) => (
          <div className="ctl-midi-binding-row" key={`note-${note}`}>
            <span className="ctl-readout">Pad {note}</span>
            <span className="ctl-row__hint">{label}</span>
            <button
              type="button"
              className="ctl-btn ctl-btn--quiet ctl-btn--icon"
              onClick={() => onRemoveNoteBinding(note)}
              aria-label={`Remove mapping for pad ${note} (${label})`}
              title="Remove mapping"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
