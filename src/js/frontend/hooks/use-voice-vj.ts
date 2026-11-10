/**
 * Hands-free voice VJing via the Web Speech API (issue #1684).
 *
 * On-device browser speech recognition (no audio leaves the browser) maps
 * spoken phrases to bounded __stims_agent actions with smooth 2-4s crossfades
 * and transient corner feedback pills.
 *
 * This is the first slice: recognition setup + phrase→action mapping for the
 * core verbs. Crossfade timing and feedback pills are handled by the existing
 * action infrastructure.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * Why listening stopped for good. `blocked`: the visitor or the browser
 * refused the microphone. `unavailable`: this browser cannot recognise speech
 * on the device, and a remote service is not an acceptable fallback.
 */
export type VoiceVJFailure = 'blocked' | 'unavailable';

export interface VoiceVJOptions {
  enabled: boolean;
  onCommand: (phrase: string) => void;
  /** Recognition cannot run; the caller should turn the feature back off. */
  onFailure?: (reason: VoiceVJFailure) => void;
}

// Minimal type shims for the Web Speech API (not in all TS lib targets).
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** When supported, keeps recognition on-device instead of a remote service. */
  processLocally?: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => ISpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Local processing is the whole privacy promise: the settings copy says audio
 * never leaves the browser. Browsers that only offer remote recognition must
 * not be presented as if they were on-device, so the feature stays hidden
 * there.
 */
function supportsLocalProcessing(ctor: SpeechRecognitionCtor): boolean {
  try {
    return 'processLocally' in new ctor();
  } catch {
    return false;
  }
}

export function useVoiceVJ(options: VoiceVJOptions): {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
} {
  const { enabled, onCommand, onFailure } = options;
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => {
    const ctor = getSpeechRecognitionCtor();
    return ctor !== null && supportsLocalProcessing(ctor);
  });

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    // Keep audio on-device. Only reachable when the browser exposes the flag
    // (see `supported`), so this is never a silent no-op under a remote path.
    rec.processLocally = true;
    if (rec.processLocally !== true) {
      // The recognizer did not accept local mode. Fail closed rather than
      // risk microphone audio reaching a remote service under a local-only
      // promise.
      setListening(false);
      onFailure?.('unavailable');
      return;
    }
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last?.isFinal) return;
      const transcript = last[0]?.transcript?.trim().toLowerCase() ?? '';
      if (transcript) onCommand(transcript);
    };
    rec.onerror = (e) => {
      // A missing local language pack must not silently fall back to remote
      // recognition, and a refused microphone will not recover on its own.
      // Stop and stay stopped until the visitor re-enables. Everything else
      // (silence, an aborted session) is routine: `onend` restarts it, and
      // the switch must not read "not listening" in between.
      const failure: VoiceVJFailure | null =
        e.error === 'not-allowed'
          ? 'blocked'
          : e.error === 'language-not-supported' ||
              e.error === 'service-not-allowed'
            ? 'unavailable'
            : null;
      if (!failure) return;
      recognitionRef.current = null;
      try {
        rec.stop();
      } catch {
        // ignore
      }
      setListening(false);
      onFailure?.(failure);
    };
    rec.onend = () => {
      // Auto-restart while enabled to keep listening.
      if (enabled && recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      onFailure?.('unavailable');
    }
  };

  const stop = () => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    setListening(false);
  };

  const startRef = useRef(start);
  startRef.current = start;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (enabled) startRef.current();
    else stopRef.current();
    return () => stopRef.current();
  }, [enabled]);

  return { supported, listening, start, stop };
}

/**
 * Map a transcript to a bounded agent action. Returns the action id + params,
 * or null if no phrase matched.
 */
export function mapVoicePhrase(
  phrase: string,
): { id: string; params?: Record<string, unknown> } | null {
  const p = phrase.toLowerCase();
  if (/\bslow\s*down\b/.test(p))
    return {
      id: 'set-sensory-knob',
      params: { knob: 'overloadCeiling', value: 0.3 },
    };
  if (/\bspeed\s*up\b|\bfaster\b/.test(p))
    return {
      id: 'set-sensory-knob',
      params: { knob: 'overloadCeiling', value: 1.0 },
    };
  if (/\bcalm\b/.test(p)) return { id: 'sensory-calm' };
  if (/\bstimulate\b|\benergize\b/.test(p)) return { id: 'sensory-stimulate' };
  if (/\bbreath(e|ing)?\b/.test(p)) return { id: 'sensory-breathing-toggle' };
  if (/\bnext\b/.test(p)) return { id: 'next-preset' };
  if (/\bprevious\b|\bback\b/.test(p)) return { id: 'previous-preset' };
  if (/\bbrowse\b/.test(p)) return { id: 'open-browse' };
  if (/\bfull\s*screen\b/.test(p)) return { id: 'toggle-fullscreen' };
  if (/\breset\b/.test(p)) return { id: 'sensory-reset' };
  return null;
}
