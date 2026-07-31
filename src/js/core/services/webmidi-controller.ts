/**
 * WebMIDI API Controller Bridge
 * Connects physical MIDI controllers (launchpads, knobs, faders)
 * directly to live MilkDrop registers and parameters.
 */

export interface MidiBindingMap {
  [ccNumber: number]: {
    target: string; // e.g. 'zoom', 'warp', 'rot', 'decay', 'q1'
    min: number;
    max: number;
  };
}

export const DEFAULT_MIDI_CC_BINDINGS: MidiBindingMap = {
  1: { target: 'zoom', min: 0.8, max: 1.2 },
  2: { target: 'warp', min: 0.0, max: 2.0 },
  3: { target: 'rot', min: -0.2, max: 0.2 },
  4: { target: 'decay', min: 0.85, max: 1.0 },
  7: { target: 'q1', min: 0.0, max: 1.0 },
  8: { target: 'q2', min: 0.0, max: 1.0 },
  9: { target: 'q3', min: 0.0, max: 1.0 },
  10: { target: 'q4', min: 0.0, max: 1.0 },
};

export class WebMidiControllerService {
  private midiAccess: MIDIAccess | null = null;
  private listeners: Set<
    (cc: number, value: number, target?: string, normalized?: number) => void
  > = new Set();
  private bindings: MidiBindingMap = { ...DEFAULT_MIDI_CC_BINDINGS };

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  public async initialize(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.attachInputListeners();
      return true;
    } catch {
      return false;
    }
  }

  public bindCc(ccNumber: number, target: string, min = 0, max = 1): void {
    this.bindings[ccNumber] = { target, min, max };
  }

  public getBindings(): MidiBindingMap {
    return { ...this.bindings };
  }

  public onControlChange(
    callback: (
      cc: number,
      value: number,
      target?: string,
      normalized?: number,
    ) => void,
  ): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public handleMidiMessage(
    data: Uint8Array,
  ): { cc: number; raw: number; target?: string; normalized?: number } | null {
    if (data.length < 3) return null;
    const status = data[0] & 0xf0;
    // 0xB0 is Control Change (CC)
    if (status !== 0xb0) return null;

    const cc = data[1];
    const raw = data[2]; // 0..127
    const binding = this.bindings[cc];

    let target: string | undefined;
    let normalized: number | undefined;

    if (binding) {
      target = binding.target;
      const ratio = raw / 127;
      normalized = binding.min + ratio * (binding.max - binding.min);
    }

    for (const listener of this.listeners) {
      listener(cc, raw, target, normalized);
    }

    return { cc, raw, target, normalized };
  }

  private attachInputListeners(): void {
    if (!this.midiAccess) return;
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (event.data) {
          this.handleMidiMessage(event.data);
        }
      };
    }
  }
}

export const webMidiService = new WebMidiControllerService();
