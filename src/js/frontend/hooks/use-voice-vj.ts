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

export interface VoiceVJOptions {
  enabled: boolean;
  onCommand: (phrase: string) => void;
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

export function useVoiceVJ(options: VoiceVJOptions): {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
} {
  const { enabled, onCommand } = options;
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const supported = getSpeechRecognitionCtor() !== null;

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last?.isFinal) return;
      const transcript = last[0]?.transcript?.trim().toLowerCase() ?? '';
      if (transcript) onCommand(transcript);
    };
    rec.onerror = () => {
      setListening(false);
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
      setListening(false);
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

  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!enabled) stopRef.current();
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
  if (/\bfullscreen\b/.test(p)) return { id: 'toggle-fullscreen' };
  if (/\breset\b/.test(p)) return { id: 'sensory-reset' };
  return null;
}
