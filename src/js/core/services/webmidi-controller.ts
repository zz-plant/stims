/**
 * WebMIDI API Controller Bridge
 * Connects physical MIDI controllers (launchpads, knobs, faders) — and a
 * virtual "Claude (MCP)" channel driven by the MCP agent bridge — directly
 * to live MilkDrop registers and parameters.
 *
 * Bindings are scoped per device and persisted to localStorage, so a
 * physical controller keeps its learned mapping across reloads and doesn't
 * collide with another controller's mapping for the same CC number.
 */

const MIDI_STATUS_NOTE_OFF = 0x80;
const MIDI_STATUS_NOTE_ON = 0x90;
const MIDI_STATUS_CONTROL_CHANGE = 0xb0;
/** System real-time messages are single-byte and start here. */
const MIDI_REALTIME_MIN = 0xf8;
const MIDI_CLOCK_TICK = 0xf8;
const MIDI_CLOCK_START = 0xfa;
const MIDI_CLOCK_CONTINUE = 0xfb;
const MIDI_CLOCK_STOP = 0xfc;
/** MIDI clock is defined as 24 ticks per quarter note. */
const MIDI_CLOCK_TICKS_PER_BEAT = 24;
/** Tick intervals kept for the tempo estimate — one beat's worth. */
const MIDI_CLOCK_INTERVAL_WINDOW = MIDI_CLOCK_TICKS_PER_BEAT;
/** Beats per bar assumed for `barPosition`. MIDI clock carries no meter. */
const MIDI_CLOCK_BEATS_PER_BAR = 4;

export interface MidiBinding {
  target: string;
  min: number;
  max: number;
}

export interface MidiBindingMap {
  [ccNumber: number]: MidiBinding;
}

/**
 * What a pad/key does when struck. `trigger` fires once on press (preset
 * advance, panel toggle); `gate` holds a value for as long as the key is
 * down and releases it; `toggle` flips between min and max on each press.
 */
export type MidiNoteMode = 'trigger' | 'gate' | 'toggle';

export interface MidiNoteBinding {
  target: string;
  mode: MidiNoteMode;
  /** Value sent on release / toggle-off. Ignored by `trigger`. */
  min: number;
  /** Value sent on press / toggle-on, scaled by velocity when `velocity`. */
  max: number;
  /** Scale `max` by how hard the pad was hit. Off for switch-like pads. */
  velocitySensitive?: boolean;
}

export interface MidiNoteBindingMap {
  [noteNumber: number]: MidiNoteBinding;
}

/** Tempo and transport as reported by an external MIDI clock master (a DJ
 * mixer, a DAW). Unlike the audio-derived beat clock this needs no inference
 * — the tempo is exact and the downbeat is where the master says it is. */
export type MidiClockSnapshot = {
  /** Null until enough ticks have arrived to estimate, or after a stop. */
  bpm: number | null;
  running: boolean;
  /** Quarter notes since the last start, counting from 0. */
  beat: number;
  /** Position within the bar in [0, 1), assuming 4/4. */
  barPosition: number;
};

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

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  kind: 'hardware' | 'virtual';
  state: 'connected' | 'disconnected';
  enabled: boolean;
}

/** Claude, driving the show through the MCP agent bridge, is modeled as
 * just another MIDI device — it reuses the exact same per-device binding,
 * learn-mode, and enable/disable machinery a physical controller gets. */
export const VIRTUAL_CLAUDE_DEVICE_ID = 'virtual:claude';

/** A gamepad is modeled the same way: its sticks and triggers arrive as CC,
 * its buttons as notes, so MIDI-learn, per-device enable, and persisted
 * bindings all work on it without a second mapping system. */
export const VIRTUAL_GAMEPAD_DEVICE_ID = 'virtual:gamepad';

const VIRTUAL_DEVICES: ReadonlyArray<{
  id: string;
  name: string;
  manufacturer: string;
}> = [
  {
    id: VIRTUAL_CLAUDE_DEVICE_ID,
    name: 'Claude (MCP)',
    manufacturer: 'Anthropic',
  },
  { id: VIRTUAL_GAMEPAD_DEVICE_ID, name: 'Gamepad', manufacturer: 'Browser' },
];

interface DeviceRecord {
  enabled: boolean;
  bindings: MidiBindingMap;
  noteBindings: MidiNoteBindingMap;
}

type PersistedState = Record<string, DeviceRecord>;

const STORAGE_KEY = 'stims:midi-state:v1';

export type MidiControlListener = (
  cc: number,
  raw: number,
  target: string | undefined,
  normalized: number | undefined,
  deviceId: string,
) => void;

export type MidiNoteEvent = {
  note: number;
  /** True on press, false on release. */
  on: boolean;
  velocity: number;
  deviceId: string;
  /** Bound target, when the note has a binding on this device. */
  target?: string;
  /** Value the binding resolves to for this event; undefined when unbound,
   * and undefined on the release edge of a `trigger` binding (which fires
   * once on press and has nothing to say about release). */
  value?: number;
  mode?: MidiNoteMode;
};

export type MidiNoteListener = (event: MidiNoteEvent) => void;

export type MidiClockListener = (snapshot: MidiClockSnapshot) => void;

type DevicesChangedListener = (devices: MidiDeviceInfo[]) => void;

/**
 * Global "touch + turn" learn: armed once from the Performance hardware
 * panel, it waits for BOTH a UI-designated target (any instrumented control
 * — the editor's per-field ⏺ path routes here automatically while armed)
 * AND a CC message, in either order, then binds them.
 */
export type GlobalLearnState =
  | { phase: 'idle' }
  | {
      phase: 'armed';
      target: string | null;
      pendingCc: { deviceId: string; cc: number } | null;
    }
  | { phase: 'bound'; target: string; cc: number; deviceId: string };

type GlobalLearnListener = (state: GlobalLearnState) => void;

function readStorage(): PersistedState {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const sanitized: PersistedState = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        continue;
      const candidate = value as Partial<DeviceRecord>;
      const bindings: MidiBindingMap = {};
      if (
        candidate.bindings &&
        typeof candidate.bindings === 'object' &&
        !Array.isArray(candidate.bindings)
      ) {
        for (const [ccKey, binding] of Object.entries(candidate.bindings)) {
          const cc = Number(ccKey);
          if (
            Number.isInteger(cc) &&
            cc >= 0 &&
            cc <= 127 &&
            binding &&
            typeof binding === 'object' &&
            typeof binding.target === 'string' &&
            Number.isFinite(binding.min) &&
            Number.isFinite(binding.max)
          )
            bindings[cc] = {
              target: binding.target,
              min: binding.min,
              max: binding.max,
            };
        }
      }
      const noteBindings: MidiNoteBindingMap = {};
      if (
        candidate.noteBindings &&
        typeof candidate.noteBindings === 'object' &&
        !Array.isArray(candidate.noteBindings)
      ) {
        for (const [noteKey, binding] of Object.entries(
          candidate.noteBindings,
        )) {
          const note = Number(noteKey);
          if (
            Number.isInteger(note) &&
            note >= 0 &&
            note <= 127 &&
            binding &&
            typeof binding === 'object' &&
            typeof binding.target === 'string' &&
            Number.isFinite(binding.min) &&
            Number.isFinite(binding.max)
          ) {
            noteBindings[note] = {
              target: binding.target,
              mode:
                binding.mode === 'gate' || binding.mode === 'toggle'
                  ? binding.mode
                  : 'trigger',
              min: binding.min,
              max: binding.max,
              velocitySensitive: binding.velocitySensitive === true,
            };
          }
        }
      }
      sanitized[id] = {
        enabled: candidate.enabled !== false,
        bindings,
        noteBindings,
      };
    }
    return sanitized;
  } catch {
    // Corrupt JSON or storage disabled (private browsing) — start fresh.
    return {};
  }
}

export class WebMidiControllerService {
  private midiAccess: MIDIAccess | null = null;
  private readonly listeners = new Set<MidiControlListener>();
  private readonly deviceListeners = new Set<DevicesChangedListener>();
  private readonly deviceRecords = new Map<string, DeviceRecord>();
  private readonly hardwareDevices = new Map<string, MidiDeviceInfo>();
  private learnTarget: string | null = null;
  private globalLearn: GlobalLearnState = { phase: 'idle' };
  private readonly globalLearnListeners = new Set<GlobalLearnListener>();
  private readonly noteListeners = new Set<MidiNoteListener>();
  private readonly clockListeners = new Set<MidiClockListener>();
  /** Output port paired with each input device, for LED/motor feedback. */
  private readonly outputs = new Map<string, MIDIOutput>();
  /** Latched state per `toggle` note binding, keyed `deviceId:note`. */
  private readonly noteToggleState = new Map<string, boolean>();
  private clock: MidiClockSnapshot = {
    bpm: null,
    running: false,
    beat: 0,
    barPosition: 0,
  };
  private clockTicks = 0;
  private clockLastTickAt: number | null = null;
  private clockIntervals: number[] = [];
  /** Device currently clocking us, so clock output never loops back to it. */
  private clockInDeviceId: string | null = null;
  private clockOutRunning = false;
  private clockOutBpmSource: (() => number | null) | null = null;
  private clockOutTimer: number | null = null;
  private clockOutNextAt = 0;

  constructor() {
    const persisted = readStorage();
    for (const [id, rec] of Object.entries(persisted)) {
      this.deviceRecords.set(id, {
        enabled: rec.enabled ?? true,
        bindings: rec.bindings ?? {},
        noteBindings: rec.noteBindings ?? {},
      });
    }
    this.ensureDeviceRecord(VIRTUAL_CLAUDE_DEVICE_ID, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  public async initialize(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.syncHardwareDevices();
      this.attachInputListeners();
      this.syncOutputs();
      // Hot-plug recovery: a controller unplugged mid-session previously
      // just went silent with no signal to the user, and one plugged in
      // after the initial connect click was never bound at all.
      this.midiAccess.onstatechange = () => {
        this.syncHardwareDevices();
        this.attachInputListeners();
        this.syncOutputs();
        this.notifyDevicesChanged();
      };
      this.notifyDevicesChanged();
      return true;
    } catch {
      return false;
    }
  }

  // ── Devices ──────────────────────────────────────────────────────
  public getDevices(): MidiDeviceInfo[] {
    const virtual: MidiDeviceInfo[] = VIRTUAL_DEVICES.map((device) => ({
      ...device,
      kind: 'virtual' as const,
      state: 'connected' as const,
      enabled: this.deviceRecords.get(device.id)?.enabled ?? true,
    }));
    return [...virtual, ...this.hardwareDevices.values()];
  }

  public onDevicesChanged(listener: DevicesChangedListener): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  public setDeviceEnabled(deviceId: string, enabled: boolean): void {
    const rec = this.ensureDeviceRecord(deviceId, {
      enabled,
      bindings: {},
      noteBindings: {},
    });
    rec.enabled = enabled;
    this.persist();
    this.notifyDevicesChanged();
  }

  private syncHardwareDevices(): void {
    if (!this.midiAccess) return;
    const seenIds = new Set<string>();
    for (const input of this.midiAccess.inputs.values()) {
      seenIds.add(input.id);
      // A controller no one has mapped yet still drives the four core
      // registers out of the box — only a learned override replaces that.
      const rec = this.ensureDeviceRecord(input.id, {
        enabled: true,
        bindings: { ...DEFAULT_MIDI_CC_BINDINGS },
        noteBindings: {},
      });
      this.hardwareDevices.set(input.id, {
        id: input.id,
        name: input.name || 'MIDI device',
        manufacturer: input.manufacturer || '',
        kind: 'hardware',
        state: input.state === 'connected' ? 'connected' : 'disconnected',
        enabled: rec.enabled,
      });
    }
    for (const [id, info] of this.hardwareDevices) {
      if (!seenIds.has(id) && info.state === 'connected') {
        this.hardwareDevices.set(id, { ...info, state: 'disconnected' });
      }
    }
  }

  private attachInputListeners(): void {
    if (!this.midiAccess) return;
    for (const input of this.midiAccess.inputs.values()) {
      const deviceId = input.id;
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (event.data) {
          this.handleMidiMessage(deviceId, event.data);
        }
      };
    }
  }

  private notifyDevicesChanged(): void {
    const devices = this.getDevices();
    for (const listener of this.deviceListeners) {
      listener(devices);
    }
  }

  private ensureDeviceRecord(id: string, fallback: DeviceRecord): DeviceRecord {
    let rec = this.deviceRecords.get(id);
    if (!rec) {
      rec = {
        enabled: fallback.enabled,
        bindings: { ...fallback.bindings },
        noteBindings: { ...fallback.noteBindings },
      };
      this.deviceRecords.set(id, rec);
      this.persist();
    }
    return rec;
  }

  // ── Learn mode ───────────────────────────────────────────────────
  public beginLearn(target: string): void {
    // While global learn is armed, every per-field arm call (the editor's
    // ⏺ buttons already go through here) converges into the global
    // handshake: touching an instrumented control designates the target
    // instead of starting a separate one-off learn.
    if (this.globalLearn.phase === 'armed') {
      this.setLearnTarget(target);
      return;
    }
    this.learnTarget = target;
  }

  public cancelLearn(): void {
    this.learnTarget = null;
    // A per-field cancel (e.g. toggling the editor's ⏺ back off) while
    // global learn is armed un-designates the target but keeps the mode
    // armed — only cancelGlobalLearn/armGlobalLearn leave the mode.
    if (this.globalLearn.phase === 'armed' && this.globalLearn.target) {
      this.globalLearn = { ...this.globalLearn, target: null };
      this.notifyGlobalLearn();
    }
  }

  public getLearnTarget(): string | null {
    return this.learnTarget;
  }

  // ── Global "touch + turn" learn ──────────────────────────────────
  /** Arm global learn: the next designated target (setLearnTarget, or any
   * per-field beginLearn call) pairs with the next CC message, in either
   * order, and the pair becomes a binding on that CC's device. */
  public armGlobalLearn(): void {
    // A pending per-field learn would race the global handshake for the
    // next CC — global mode supersedes it.
    this.learnTarget = null;
    this.globalLearn = { phase: 'armed', target: null, pendingCc: null };
    this.notifyGlobalLearn();
  }

  public cancelGlobalLearn(): void {
    if (this.globalLearn.phase === 'idle') return;
    this.globalLearn = { phase: 'idle' };
    this.notifyGlobalLearn();
  }

  /** Designate the target half of an armed global learn. Called by
   * instrumented controls when the user touches them; a no-op unless
   * global learn is armed. */
  public setLearnTarget(target: string): void {
    if (this.globalLearn.phase !== 'armed' || !target) return;
    const pending = this.globalLearn.pendingCc;
    if (pending) {
      this.completeGlobalLearn(target, pending.deviceId, pending.cc);
      return;
    }
    this.globalLearn = { ...this.globalLearn, target };
    this.notifyGlobalLearn();
  }

  public getGlobalLearnState(): GlobalLearnState {
    return this.globalLearn;
  }

  public onGlobalLearnChanged(listener: GlobalLearnListener): () => void {
    this.globalLearnListeners.add(listener);
    return () => this.globalLearnListeners.delete(listener);
  }

  private completeGlobalLearn(
    target: string,
    deviceId: string,
    cc: number,
  ): void {
    // Settle state before bindCc, mirroring the per-field ordering: bindCc
    // synchronously fires onDevicesChanged, and listeners probing "did
    // learn just finish" must observe the completed state, not the armed
    // one that's about to flip.
    this.globalLearn = { phase: 'bound', target, cc, deviceId };
    this.notifyGlobalLearn();
    this.bindCc(deviceId, cc, target, 0, 1);
  }

  private notifyGlobalLearn(): void {
    for (const listener of this.globalLearnListeners) {
      listener(this.globalLearn);
    }
  }

  // ── Bindings ─────────────────────────────────────────────────────
  public bindCc(
    deviceId: string,
    ccNumber: number,
    target: string,
    min = 0,
    max = 1,
  ): void {
    const rec = this.ensureDeviceRecord(deviceId, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
    rec.bindings[ccNumber] = { target, min, max };
    this.persist();
    // Reused as a general "MIDI state changed" signal — the UI's bindings
    // table re-reads getAllBindings() off the same event rather than
    // needing a second listener type just for this.
    this.notifyDevicesChanged();
  }

  public unbindCc(deviceId: string, ccNumber: number): void {
    const rec = this.deviceRecords.get(deviceId);
    if (!rec || !(ccNumber in rec.bindings)) return;
    delete rec.bindings[ccNumber];
    this.persist();
    this.notifyDevicesChanged();
  }

  public getBindings(deviceId: string): MidiBindingMap {
    return { ...(this.deviceRecords.get(deviceId)?.bindings ?? {}) };
  }

  public getAllBindings(): Record<string, MidiBindingMap> {
    const out: Record<string, MidiBindingMap> = {};
    for (const [id, rec] of this.deviceRecords) {
      out[id] = { ...rec.bindings };
    }
    return out;
  }

  /** Union of every bound target across enabled devices only — a disabled
   * device's bindings still exist (see setDeviceEnabled) but shouldn't mark
   * anything as "MIDI is driving this" in the editor gutter. */
  public getEnabledTargets(): Set<string> {
    const targets = new Set<string>();
    for (const rec of this.deviceRecords.values()) {
      if (!rec.enabled) continue;
      for (const binding of Object.values(rec.bindings)) {
        targets.add(binding.target);
      }
    }
    return targets;
  }

  // ── Message handling ────────────────────────────────────────────
  public handleMidiMessage(
    deviceId: string,
    data: Uint8Array,
  ): { cc: number; raw: number; target?: string; normalized?: number } | null {
    if (data.length < 1) return null;
    const status = data[0];

    // System real-time (0xF8-0xFF) is a SINGLE byte and may be interleaved
    // anywhere, even mid-message. It must be handled before the 3-byte length
    // guard below, which used to drop every clock tick on the floor.
    if (status >= MIDI_REALTIME_MIN) {
      this.handleRealtimeMessage(status, deviceId);
      return null;
    }

    if (data.length < 3) return null;
    const kind = status & 0xf0;
    if (kind === MIDI_STATUS_CONTROL_CHANGE) {
      return this.applyControlChange(deviceId, data[1], data[2]);
    }
    if (kind === MIDI_STATUS_NOTE_ON || kind === MIDI_STATUS_NOTE_OFF) {
      const velocity = data[2];
      // A note-on with velocity 0 is the conventional note-off — most
      // controllers send it that way and never emit a real 0x80.
      const on = kind === MIDI_STATUS_NOTE_ON && velocity > 0;
      this.applyNote(deviceId, data[1], on, velocity);
      return null;
    }
    return null;
  }

  /** Virtual-device entry point: same CC/value shape a physical knob would
   * send, so a device's learned mapping applies identically whether the
   * motion came from hardware or from Claude over the MCP bridge. */
  public injectControlChange(
    deviceId: string,
    cc: number,
    raw: number,
  ): { cc: number; raw: number; target?: string; normalized?: number } {
    return this.applyControlChange(deviceId, cc, raw);
  }

  /** Virtual-device entry point that skips CC math entirely — Claude asks
   * for a target by name ("set warp to 1.4") instead of reverse-engineering
   * a CC-to-range mapping. */
  public injectTargetValue(
    deviceId: string,
    target: string,
    value: number,
  ): void {
    if (!target || !Number.isFinite(value)) return;
    const rec = this.ensureDeviceRecord(deviceId, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
    if (!rec.enabled) return;
    for (const listener of this.listeners) {
      listener(-1, Number.NaN, target, value, deviceId);
    }
  }

  private applyControlChange(
    deviceId: string,
    cc: number,
    raw: number,
  ): { cc: number; raw: number; target?: string; normalized?: number } {
    if (this.globalLearn.phase === 'armed') {
      if (this.globalLearn.target) {
        // Target was designated first — this CC completes the handshake,
        // and the same motion immediately drives the fresh binding below.
        this.completeGlobalLearn(this.globalLearn.target, deviceId, cc);
      } else if (
        this.globalLearn.pendingCc?.deviceId !== deviceId ||
        this.globalLearn.pendingCc?.cc !== cc
      ) {
        // CC arrived first — park it and keep waiting for a touch.
        this.globalLearn = {
          ...this.globalLearn,
          pendingCc: { deviceId, cc },
        };
        this.notifyGlobalLearn();
      }
    } else if (this.learnTarget !== null) {
      // Clear before bindCc, not after: bindCc synchronously fires
      // onDevicesChanged, and a listener asking "did learn just finish"
      // via getLearnTarget() === null during that notification must see
      // the already-cleared state, not the target that's about to be
      // cleared a line later.
      const target = this.learnTarget;
      this.learnTarget = null;
      this.bindCc(deviceId, cc, target, 0, 1);
    }

    const rec = this.ensureDeviceRecord(deviceId, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
    if (!rec.enabled) {
      return { cc, raw };
    }

    const binding = rec.bindings[cc];
    let target: string | undefined;
    let normalized: number | undefined;

    if (binding) {
      target = binding.target;
      const ratio = raw / 127;
      normalized = binding.min + ratio * (binding.max - binding.min);
    }

    for (const listener of this.listeners) {
      listener(cc, raw, target, normalized, deviceId);
    }

    return { cc, raw, target, normalized };
  }

  public onControlChange(listener: MidiControlListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Notes (pads, keys, buttons) ─────────────────────────────────
  public bindNote(
    deviceId: string,
    note: number,
    target: string,
    options: {
      mode?: MidiNoteMode;
      min?: number;
      max?: number;
      velocitySensitive?: boolean;
    } = {},
  ): void {
    const rec = this.ensureDeviceRecord(deviceId, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
    rec.noteBindings[note] = {
      target,
      mode: options.mode ?? 'trigger',
      min: options.min ?? 0,
      max: options.max ?? 1,
      velocitySensitive: options.velocitySensitive === true,
    };
    this.persist();
    this.notifyDevicesChanged();
  }

  public unbindNote(deviceId: string, note: number): void {
    const rec = this.deviceRecords.get(deviceId);
    if (!rec || !(note in rec.noteBindings)) return;
    delete rec.noteBindings[note];
    this.noteToggleState.delete(`${deviceId}:${note}`);
    this.persist();
    this.notifyDevicesChanged();
  }

  public getNoteBindings(deviceId: string): MidiNoteBindingMap {
    return { ...(this.deviceRecords.get(deviceId)?.noteBindings ?? {}) };
  }

  public onNote(listener: MidiNoteListener): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  /** Virtual-device entry point, mirroring injectControlChange. */
  public injectNote(
    deviceId: string,
    note: number,
    on: boolean,
    velocity = 127,
  ): void {
    this.applyNote(deviceId, note, on, velocity);
  }

  private applyNote(
    deviceId: string,
    note: number,
    on: boolean,
    velocity: number,
  ): void {
    const rec = this.ensureDeviceRecord(deviceId, {
      enabled: true,
      bindings: {},
      noteBindings: {},
    });
    if (!rec.enabled) return;

    const binding = rec.noteBindings[note];
    const event: MidiNoteEvent = { note, on, velocity, deviceId };

    if (binding) {
      event.target = binding.target;
      event.mode = binding.mode;
      const pressed = binding.velocitySensitive
        ? binding.min + (velocity / 127) * (binding.max - binding.min)
        : binding.max;
      if (binding.mode === 'trigger') {
        // Fires once, on press. The release edge still reaches listeners so
        // a UI can un-light the pad, but carries no value to apply.
        if (on) event.value = pressed;
      } else if (binding.mode === 'gate') {
        event.value = on ? pressed : binding.min;
      } else if (on) {
        // Toggle flips on the press edge only; the release is inert.
        const key = `${deviceId}:${note}`;
        const next = !this.noteToggleState.get(key);
        this.noteToggleState.set(key, next);
        event.value = next ? pressed : binding.min;
      }
    }

    for (const listener of this.noteListeners) {
      listener(event);
    }
    // Echo the pad's own state back to its LED without waiting for a
    // round-trip through the app.
    this.sendNote(deviceId, note, on ? Math.max(velocity, 1) : 0);
  }

  // ── Clock (external tempo master) ────────────────────────────────
  public getClockSnapshot(): MidiClockSnapshot {
    return this.clock;
  }

  public onClock(listener: MidiClockListener): () => void {
    this.clockListeners.add(listener);
    return () => this.clockListeners.delete(listener);
  }

  // ── Clock output (Stims as tempo master) ────────────────────────
  /**
   * Drives 24 ticks per beat out to every enabled output port, so lighting
   * desks and DAWs can follow the visuals' tempo.
   *
   * Timing is a self-correcting `setTimeout` chain: each tick schedules the
   * next against an absolute target so error cannot accumulate, but a browser
   * timer still jitters by a millisecond or two under load, and the tab being
   * backgrounded will clamp it badly. That is fine for lighting cues and
   * unacceptable for sample-accurate sync — anything needing the latter should
   * be the master and send clock TO us instead.
   */
  public startClockOutput(getBpm: () => number | null): void {
    this.stopClockOutput();
    this.clockOutBpmSource = getBpm;
    this.clockOutRunning = true;
    this.broadcastRealtime(MIDI_CLOCK_START);
    this.clockOutNextAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.scheduleClockOutTick();
  }

  public stopClockOutput(): void {
    if (this.clockOutTimer !== null) {
      clearTimeout(this.clockOutTimer);
      this.clockOutTimer = null;
    }
    if (this.clockOutRunning) {
      this.broadcastRealtime(MIDI_CLOCK_STOP);
    }
    this.clockOutRunning = false;
    this.clockOutBpmSource = null;
  }

  public isClockOutputRunning(): boolean {
    return this.clockOutRunning;
  }

  private scheduleClockOutTick(): void {
    if (!this.clockOutRunning) return;
    const bpm = this.clockOutBpmSource?.() ?? null;
    // No trustworthy tempo means no tick: emitting a guessed clock is worse
    // than emitting none, because followers will lock onto the guess.
    if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) {
      this.clockOutTimer = setTimeout(() => {
        this.clockOutTimer = null;
        this.clockOutNextAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.scheduleClockOutTick();
      }, 100) as unknown as number;
      return;
    }
    const tickMs = 60000 / bpm / MIDI_CLOCK_TICKS_PER_BEAT;
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.clockOutNextAt += tickMs;
    // A long stall (tab throttled, GC pause) leaves the target in the past;
    // catching up by firing a burst of ticks would sound like a tempo spike,
    // so the schedule is reset to now instead.
    if (this.clockOutNextAt < now) this.clockOutNextAt = now + tickMs;
    this.clockOutTimer = setTimeout(
      () => {
        this.clockOutTimer = null;
        this.broadcastRealtime(MIDI_CLOCK_TICK);
        this.scheduleClockOutTick();
      },
      Math.max(0, this.clockOutNextAt - now),
    ) as unknown as number;
  }

  private broadcastRealtime(status: number): void {
    for (const [deviceId, output] of this.outputs) {
      if (this.deviceRecords.get(deviceId)?.enabled === false) continue;
      // Never send clock back to whoever is clocking us — that is a loop.
      if (deviceId === this.clockInDeviceId) continue;
      try {
        output.send([status]);
      } catch {
        // Port vanished mid-send; clock output is best-effort.
      }
    }
  }

  private handleRealtimeMessage(status: number, deviceId?: string): void {
    if (deviceId) this.clockInDeviceId = deviceId;
    if (status === MIDI_CLOCK_TICK) {
      this.handleClockTick();
      return;
    }
    if (status === MIDI_CLOCK_START) {
      // Start means "from the top": the next tick is beat 0 of bar 1.
      this.clockTicks = 0;
      this.clockLastTickAt = null;
      this.clockIntervals = [];
      this.setClock({ ...this.clock, running: true, beat: 0, barPosition: 0 });
      return;
    }
    if (status === MIDI_CLOCK_CONTINUE) {
      // Continue resumes from the current position — the tick counter and
      // tempo estimate both survive.
      this.clockLastTickAt = null;
      this.setClock({ ...this.clock, running: true });
      return;
    }
    if (status === MIDI_CLOCK_STOP) {
      this.clockLastTickAt = null;
      this.setClock({ ...this.clock, running: false });
    }
  }

  private handleClockTick(): void {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.clockLastTickAt !== null) {
      const interval = now - this.clockLastTickAt;
      // A plausible tick spans ~2.5ms (1000bpm) to ~62ms (40bpm); anything
      // outside that is a dropped/bunched tick, not tempo evidence.
      if (interval > 2 && interval < 100) {
        this.clockIntervals.push(interval);
        if (this.clockIntervals.length > MIDI_CLOCK_INTERVAL_WINDOW) {
          this.clockIntervals.shift();
        }
      }
    }
    this.clockLastTickAt = now;
    this.clockTicks += 1;

    const beat = Math.floor(this.clockTicks / MIDI_CLOCK_TICKS_PER_BEAT);
    const withinBeat =
      (this.clockTicks % MIDI_CLOCK_TICKS_PER_BEAT) / MIDI_CLOCK_TICKS_PER_BEAT;
    const barPosition =
      ((beat % MIDI_CLOCK_BEATS_PER_BAR) + withinBeat) /
      MIDI_CLOCK_BEATS_PER_BAR;

    let bpm = this.clock.bpm;
    if (this.clockIntervals.length >= MIDI_CLOCK_TICKS_PER_BEAT / 2) {
      const mean =
        this.clockIntervals.reduce((sum, value) => sum + value, 0) /
        this.clockIntervals.length;
      bpm = 60000 / (mean * MIDI_CLOCK_TICKS_PER_BEAT);
    }

    this.setClock({ bpm, running: true, beat, barPosition });
  }

  private setClock(next: MidiClockSnapshot): void {
    this.clock = next;
    for (const listener of this.clockListeners) {
      listener(next);
    }
  }

  // ── Output (LED / motor-fader feedback) ─────────────────────────
  /**
   * Pairs each input with the output port of the same device. WebMIDI gives
   * inputs and outputs separate ids, so there is no direct handle from one to
   * the other; name is the only field both sides share. Without this a
   * controller's LEDs and motor faders can never reflect app state, which on
   * a pad grid in a dark room is most of the interface.
   */
  private syncOutputs(): void {
    if (!this.midiAccess) return;
    this.outputs.clear();
    const outputsByName = new Map<string, MIDIOutput>();
    for (const output of this.midiAccess.outputs.values()) {
      if (output.name) outputsByName.set(output.name, output);
    }
    for (const input of this.midiAccess.inputs.values()) {
      const paired =
        (input.name ? outputsByName.get(input.name) : undefined) ??
        // Some drivers suffix the port direction ("Launchpad MIDI In" vs
        // "... MIDI Out"); fall back to a shared prefix before giving up.
        [...outputsByName.values()].find(
          (candidate) =>
            input.name &&
            candidate.name &&
            (candidate.name.startsWith(input.name.split(' MIDI')[0]) ||
              input.name.startsWith(candidate.name.split(' MIDI')[0])),
        );
      if (paired) this.outputs.set(input.id, paired);
    }
  }

  public hasOutput(deviceId: string): boolean {
    return this.outputs.has(deviceId);
  }

  public sendControlChange(deviceId: string, cc: number, value: number): void {
    const output = this.outputs.get(deviceId);
    if (!output) return;
    if (this.deviceRecords.get(deviceId)?.enabled === false) return;
    const clamped = Math.max(0, Math.min(127, Math.round(value)));
    try {
      output.send([MIDI_STATUS_CONTROL_CHANGE, cc & 0x7f, clamped]);
    } catch {
      // A port can vanish between the outputs sync and this send (unplug);
      // feedback is cosmetic, so a failure must never break the frame.
    }
  }

  public sendNote(deviceId: string, note: number, velocity: number): void {
    const output = this.outputs.get(deviceId);
    if (!output) return;
    if (this.deviceRecords.get(deviceId)?.enabled === false) return;
    const clamped = Math.max(0, Math.min(127, Math.round(velocity)));
    try {
      output.send([MIDI_STATUS_NOTE_ON, note & 0x7f, clamped]);
    } catch {
      // See sendControlChange.
    }
  }

  /**
   * Push a value back out to every control bound to `target`, so a motorised
   * fader tracks the preset and a pad's LED matches what it is driving.
   * `value` is in the binding's own units (the same number a listener
   * received), and is mapped back through the binding's range.
   */
  public publishTargetValue(
    target: string,
    value: number,
    /** Device the change came from. Echoing a motorised fader's own move back
     * at it makes it fight the hand holding it, so the originator is skipped. */
    originDeviceId?: string,
  ): void {
    if (!target || !Number.isFinite(value)) return;
    for (const [deviceId, rec] of this.deviceRecords) {
      if (deviceId === originDeviceId) continue;
      if (!rec.enabled || !this.outputs.has(deviceId)) continue;
      for (const [ccKey, binding] of Object.entries(rec.bindings)) {
        if (binding.target !== target) continue;
        const span = binding.max - binding.min;
        // A zero-width range has no position to report; leave the control be
        // rather than snapping it to an arbitrary end.
        if (Math.abs(span) < 1e-9) continue;
        const ratio = (value - binding.min) / span;
        this.sendControlChange(
          deviceId,
          Number(ccKey),
          Math.max(0, Math.min(1, ratio)) * 127,
        );
      }
      for (const [noteKey, binding] of Object.entries(rec.noteBindings)) {
        if (binding.target !== target) continue;
        const lit = Math.abs(value - binding.min) > 1e-9;
        this.sendNote(deviceId, Number(noteKey), lit ? 127 : 0);
      }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────
  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const out: PersistedState = {};
      for (const [id, rec] of this.deviceRecords) {
        out[id] = rec;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // Storage quota exceeded or disabled — bindings just won't survive
      // a reload this session, which is a fine degradation.
    }
  }
}

export const webMidiService = new WebMidiControllerService();
