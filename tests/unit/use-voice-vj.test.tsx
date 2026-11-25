/**
 * `useVoiceVJ`: what happens when recognition cannot run.
 *
 * The settings switch promises that commands are being heard. A refused
 * microphone or a browser without on-device speech must report a failure so
 * the caller can turn the switch back off, while routine interruptions
 * (silence) must not, because recognition restarts on its own.
 *
 * Only the browser's SpeechRecognition is faked; the hook runs for real.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  mapVoicePhrase,
  useVoiceVJ,
  type VoiceVJFailure,
} from '../../src/js/frontend/hooks/use-voice-vj.ts';
import { buildPaletteActions } from '../../src/js/frontend/palette-actions.ts';
import { paletteActionContext } from '../frontend-harness.tsx';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  starts = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts += 1;
  }
  stop() {}
}

type SpeechWindow = { SpeechRecognition?: unknown };

let root: Root;
let host: HTMLDivElement;
let failures: VoiceVJFailure[];
let listening = false;

function Probe({ enabled }: { enabled: boolean }) {
  const voice = useVoiceVJ({
    enabled,
    onCommand: () => {},
    onFailure: (reason) => failures.push(reason),
  });
  listening = voice.listening;
  return null;
}

/** The recognizer the hook is listening on (it probes support with others). */
const active = () => {
  const rec = FakeRecognition.instances.findLast((r) => r.starts > 0);
  if (!rec) throw new Error('recognition never started');
  return rec;
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  FakeRecognition.instances = [];
  failures = [];
  (window as unknown as SpeechWindow).SpeechRecognition = FakeRecognition;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as SpeechWindow).SpeechRecognition;
});

describe('useVoiceVJ failures', () => {
  test('a refused microphone reports blocked and stops listening', () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    expect(listening).toBe(true);

    const rec = active();
    act(() => rec.onerror?.({ error: 'not-allowed' }));

    expect(failures).toEqual(['blocked']);
    expect(listening).toBe(false);
    // Stopped for good: the session ending must not restart it.
    act(() => rec.onend?.());
    expect(rec.starts).toBe(1);
  });

  test('a missing on-device language pack reports unavailable', () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    act(() => active().onerror?.({ error: 'language-not-supported' }));

    expect(failures).toEqual(['unavailable']);
    expect(listening).toBe(false);
  });

  test('silence is not a failure: listening continues and restarts', () => {
    act(() => root.render(createElement(Probe, { enabled: true })));
    const rec = active();
    act(() => {
      rec.onerror?.({ error: 'no-speech' });
      rec.onend?.();
    });

    expect(failures).toEqual([]);
    expect(listening).toBe(true);
    expect(rec.starts).toBe(2);
  });
});

describe('useVoiceVJ stays on the device', () => {
  /** A recognizer that only offers a remote service: no `processLocally`. */
  class RemoteOnlyRecognition {
    static starts = 0;
    lang = '';
    continuous = false;
    interimResults = false;
    onresult = null;
    onerror = null;
    onend = null;
    start() {
      RemoteOnlyRecognition.starts += 1;
    }
    stop() {}
  }

  test('a recognizer without local mode is never started, even when switched on', () => {
    RemoteOnlyRecognition.starts = 0;
    (window as unknown as SpeechWindow).SpeechRecognition =
      RemoteOnlyRecognition;
    let supported = true;
    function RemoteProbe() {
      const voice = useVoiceVJ({
        enabled: true,
        onCommand: () => {},
        onFailure: (reason) => failures.push(reason),
      });
      supported = voice.supported;
      listening = voice.listening;
      return null;
    }

    act(() => root.render(createElement(RemoteProbe)));

    expect(supported).toBe(false);
    // Starting is what sends microphone audio to the recognition service.
    expect(RemoteOnlyRecognition.starts).toBe(0);
    expect(listening).toBe(false);
    expect(failures).toEqual(['unavailable']);
  });
});

describe('mapVoicePhrase', () => {
  const paletteIds = new Set(
    buildPaletteActions(paletteActionContext()).map((action) => action.id),
  );

  test.each([
    ['next one please', 'next-preset'],
    ['go back', 'previous-preset'],
    ['slow down', 'sensory-calm'],
    ['calm', 'sensory-calm'],
    ['speed up', 'sensory-stimulate'],
    ['faster', 'sensory-stimulate'],
    ['stimulate', 'sensory-stimulate'],
    ['breathe', 'sensory-breathing-toggle'],
    ['browse', 'open-browse'],
    ['full screen', 'toggle-fullscreen'],
    ['reset', 'sensory-reset'],
  ])('"%s" runs the palette action %s', (phrase, id) => {
    const command = mapVoicePhrase(phrase);
    expect(command?.id).toBe(id);
    // App.tsx runs voice commands through the palette: an id it does not
    // have is a command that silently does nothing.
    expect(paletteIds.has(id)).toBe(true);
  });

  test('an unknown phrase maps to nothing', () => {
    expect(mapVoicePhrase('what a lovely song')).toBeNull();
  });
});
