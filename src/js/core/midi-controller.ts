/**
 * WebMIDI API Hardware Controller Manager
 *
 * Enables physical MIDI faders, knobs, and launchpads (e.g., Akai APC, Novation Launchpad)
 * to control visualizer parameters (`zoom`, `warp`, `rot`, `decay`, `dx`, `dy`) in real time.
 */

export interface MidiMapping {
  channel: number;
  control: number;
  parameter: string;
  minValue: number;
  maxValue: number;
}

export type MidiListener = (parameter: string, normalizedValue: number) => void;

export class MidiControllerManager {
  private midiAccess: MIDIAccess | null = null;
  private mappings = new Map<string, MidiMapping>();
  private listeners = new Set<MidiListener>();
  private activeLearnParameter: string | null = null;

  constructor() {
    this.setupDefaultMappings();
  }

  private setupDefaultMappings(): void {
    // Default MIDI Control Change (CC) mappings for standard DJ/VJ controllers
    this.addMapping({
      channel: 1,
      control: 1,
      parameter: 'zoom',
      minValue: 0.8,
      maxValue: 1.2,
    });
    this.addMapping({
      channel: 1,
      control: 2,
      parameter: 'warp',
      minValue: 0.0,
      maxValue: 0.1,
    });
    this.addMapping({
      channel: 1,
      control: 3,
      parameter: 'rot',
      minValue: -0.1,
      maxValue: 0.1,
    });
    this.addMapping({
      channel: 1,
      control: 4,
      parameter: 'decay',
      minValue: 0.8,
      maxValue: 1.0,
    });
  }

  public async initialize(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return false;
    }
    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.bindInputs();
      return true;
    } catch {
      return false;
    }
  }

  private bindInputs(): void {
    if (!this.midiAccess) return;
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = this.handleMidiMessage.bind(this);
    }
  }

  private handleMidiMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;

    const status = data[0];
    const control = data[1];
    const rawValue = data[2];
    if (status === undefined || control === undefined || rawValue === undefined)
      return;
    const channel = (status & 0x0f) + 1;
    const command = status & 0xf0;

    // Control Change (CC) message (0xB0 = 176)
    if (command === 0xb0) {
      const key = `${channel}:${control}`;
      if (this.activeLearnParameter) {
        this.addMapping({
          channel,
          control,
          parameter: this.activeLearnParameter,
          minValue: 0,
          maxValue: 1,
        });
        this.activeLearnParameter = null;
      }

      const mapping = this.mappings.get(key);
      if (mapping) {
        const normalized = rawValue / 127.0;
        const mappedValue =
          mapping.minValue + normalized * (mapping.maxValue - mapping.minValue);
        this.notifyListeners(mapping.parameter, mappedValue);
      }
    }
  }

  public enableLearnMode(parameter: string): void {
    this.activeLearnParameter = parameter;
  }

  public disableLearnMode(): void {
    this.activeLearnParameter = null;
  }

  public addMapping(mapping: MidiMapping): void {
    const key = `${mapping.channel}:${mapping.control}`;
    this.mappings.set(key, mapping);
  }

  public onValueChange(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(parameter: string, value: number): void {
    for (const listener of this.listeners) {
      listener(parameter, value);
    }
  }
}
