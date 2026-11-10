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
  useVoiceVJ,
  type VoiceVJFailure,
} from '../../src/js/frontend/hooks/use-voice-vj.ts';

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
