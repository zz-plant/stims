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

export interface MidiBinding {
  target: string;
  min: number;
  max: number;
}

export interface MidiBindingMap {
  [ccNumber: number]: MidiBinding;
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

interface DeviceRecord {
  enabled: boolean;
  bindings: MidiBindingMap;
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
      sanitized[id] = { enabled: candidate.enabled !== false, bindings };
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

  constructor() {
    const persisted = readStorage();
    for (const [id, rec] of Object.entries(persisted)) {
      this.deviceRecords.set(id, {
        enabled: rec.enabled ?? true,
        bindings: rec.bindings ?? {},
      });
    }
    this.ensureDeviceRecord(VIRTUAL_CLAUDE_DEVICE_ID, {
      enabled: true,
      bindings: {},
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
      // Hot-plug recovery: a controller unplugged mid-session previously
      // just went silent with no signal to the user, and one plugged in
      // after the initial connect click was never bound at all.
      this.midiAccess.onstatechange = () => {
        this.syncHardwareDevices();
        this.attachInputListeners();
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
    const virtual: MidiDeviceInfo = {
      id: VIRTUAL_CLAUDE_DEVICE_ID,
      name: 'Claude (MCP)',
      manufacturer: 'Anthropic',
      kind: 'virtual',
      state: 'connected',
      enabled:
        this.deviceRecords.get(VIRTUAL_CLAUDE_DEVICE_ID)?.enabled ?? true,
    };
    return [virtual, ...this.hardwareDevices.values()];
  }

  public onDevicesChanged(listener: DevicesChangedListener): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  public setDeviceEnabled(deviceId: string, enabled: boolean): void {
    const rec = this.ensureDeviceRecord(deviceId, { enabled, bindings: {} });
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
      rec = { enabled: fallback.enabled, bindings: { ...fallback.bindings } };
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
    if (data.length < 3) return null;
    const status = data[0] & 0xf0;
    // 0xB0 is Control Change (CC)
    if (status !== 0xb0) return null;
    return this.applyControlChange(deviceId, data[1], data[2]);
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
