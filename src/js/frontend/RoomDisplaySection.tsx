import { useId, useState } from 'react';
import {
  buildRoomUrl,
  ROOM_DEFAULT_DWELL_SECONDS,
  type RoomLinkOptions,
} from '../core/room-mode.ts';

const DWELL_STEPS = [
  { value: 60, label: '1 min' },
  { value: ROOM_DEFAULT_DWELL_SECONDS, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 1200, label: '20 min' },
];

const BRIGHTNESS_STEPS = [
  { value: 1, label: '100%' },
  { value: 0.8, label: '80%' },
  { value: 0.6, label: '60%' },
  { value: 0.4, label: '40%' },
];

const MOTION_STEPS = [
  { value: 1, label: '100%' },
  { value: 0.6, label: '60%' },
  { value: 0.3, label: '30%' },
  { value: 0, label: 'Still' },
];

/**
 * Builds the `?room=1` link (core/room-mode.ts) from a few choices, so a
 * room is set up by opening one address on the room's computer instead of
 * by walking that computer through Settings.
 */
export function RoomDisplaySection() {
  const id = useId();
  const [options, setOptions] = useState<RoomLinkOptions>({
    audio: 'demo',
    dwellSeconds: ROOM_DEFAULT_DWELL_SECONDS,
    stageBrightness: 0.8,
    motionScale: 0.6,
  });
  const [copied, setCopied] = useState(false);
  const url = buildRoomUrl(window.location.origin, options);

  const update = (patch: Partial<RoomLinkOptions>) => {
    setOptions((previous) => ({ ...previous, ...patch }));
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard unavailable; the link is printed below to copy by hand.
    }
  };

  return (
    <section className="ctl-section" aria-labelledby={`${id}-title`}>
      <div className="ctl-section__head">
        <h3 className="ctl-section__title" id={`${id}-title`}>
          Room display
        </h3>
      </div>
      <p className="ctl-row__hint">
        A link for a screen nobody operates, such as a sensory room or a waiting
        area. It opens straight onto the visuals with Reduce flashing on,
        changes preset by slow dissolve, keeps the screen awake, and hides the
        controls and the pointer. Keys and taps on the stage change nothing.
        None of it is saved on the computer that opens it.
      </p>
      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor={`${id}-audio`}>
            Sound
          </label>
          <span className="ctl-row__hint">
            The demo track needs no permission. The microphone follows the
            room's own music; the browser asks once.
          </span>
        </span>
        <select
          id={`${id}-audio`}
          className="ctl-select ctl-select--auto"
          value={options.audio}
          onChange={(e) =>
            update({ audio: e.target.value as RoomLinkOptions['audio'] })
          }
        >
          <option value="demo">Demo track</option>
          <option value="microphone">Microphone</option>
        </select>
      </div>
      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor={`${id}-dwell`}>
            Change preset every
          </label>
        </span>
        <select
          id={`${id}-dwell`}
          className="ctl-select ctl-select--auto"
          value={options.dwellSeconds}
          onChange={(e) => update({ dwellSeconds: Number(e.target.value) })}
        >
          {DWELL_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>
      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor={`${id}-brightness`}>
            Brightness ceiling
          </label>
        </span>
        <select
          id={`${id}-brightness`}
          className="ctl-select ctl-select--auto"
          value={options.stageBrightness}
          onChange={(e) => update({ stageBrightness: Number(e.target.value) })}
        >
          {BRIGHTNESS_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>
      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor={`${id}-motion`}>
            Motion
          </label>
          <span className="ctl-row__hint">
            Scales zoom, spin and drift. Still keeps the waveforms moving.
          </span>
        </span>
        <select
          id={`${id}-motion`}
          className="ctl-select ctl-select--auto"
          value={options.motionScale}
          onChange={(e) => update({ motionScale: Number(e.target.value) })}
        >
          {MOTION_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>
      <p className="ctl-readout ctl-readout--wrap" data-room-link>
        {url}
      </p>
      <p className="ctl-row__hint">
        Browsers hold sound until someone clicks the page, so click the screen
        once each time the room computer starts.
      </p>
      <div className="ctl-row">
        <button
          type="button"
          className="ctl-btn"
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy room link'}
        </button>
        <a className="ctl-btn ctl-btn--quiet" href={url}>
          Open it here
        </a>
      </div>
    </section>
  );
}
