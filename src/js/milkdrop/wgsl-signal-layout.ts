import type { MilkdropRuntimeSignals } from './runtime-types.ts';

export const MILKDROP_WGSL_SIGNAL_FIELDS = [
  'time',
  'frame',
  'fps',
  'aspect',
  'bass',
  'mid',
  'mids',
  'treb',
  'treble',
  'bass_att',
  'mid_att',
  'mids_att',
  'treb_att',
  'treble_att',
  'bassAtt',
  'midAtt',
  'midsAtt',
  'trebleAtt',
  'beat',
  'beat_pulse',
  'beatPulse',
  'beat_bass',
  'beat_mid',
  'beat_treb',
  'beatBass',
  'beatMid',
  'beatTreble',
  'bandFlux',
  'rms',
  'vol',
  'music',
  'weighted_energy',
  'progress',
  'aspectx',
  'aspecty',
  'pixelsx',
  'pixelsy',
] as const;

/** Nominal major-axis resolution used when the host has not reported real
 * viewport pixels — presets read pixelsx/pixelsy only for resolution-relative
 * scaling, so any plausible value beats the previous implicit 0. */
const FALLBACK_MAJOR_AXIS_PIXELS = 1280;

/** MilkDrop exposes the inverse aspect pair to presets: both values are >= 1
 * and only the minor axis is stretched (aspectx = h/w on portrait, aspecty =
 * w/h on landscape). */
export function deriveMilkdropViewportSignalValues(signals: {
  aspect?: number;
  pixelsx?: number;
  pixelsy?: number;
}) {
  const aspect =
    signals.aspect && Number.isFinite(signals.aspect) && signals.aspect > 0
      ? signals.aspect
      : 1;
  const pixelsx =
    signals.pixelsx ??
    (aspect >= 1
      ? FALLBACK_MAJOR_AXIS_PIXELS
      : Math.round(FALLBACK_MAJOR_AXIS_PIXELS * aspect));
  const pixelsy =
    signals.pixelsy ??
    (aspect >= 1
      ? Math.round(FALLBACK_MAJOR_AXIS_PIXELS / aspect)
      : FALLBACK_MAJOR_AXIS_PIXELS);
  return {
    aspectx: aspect < 1 ? 1 / aspect : 1,
    aspecty: aspect > 1 ? aspect : 1,
    pixelsx,
    pixelsy,
  };
}

export type MilkdropWgslSignalField =
  (typeof MILKDROP_WGSL_SIGNAL_FIELDS)[number];

// Parser identifiers are case-insensitive, but the runtime exposes both the
// legacy snake_case names and the newer camelCase aliases.
export const MILKDROP_WGSL_SIGNAL_ALIAS_MAP = new Map<
  string,
  MilkdropWgslSignalField
>([
  ...MILKDROP_WGSL_SIGNAL_FIELDS.map(
    (field) => [field.toLowerCase(), field] as const,
  ),
  ['weightedenergy', 'weighted_energy'],
]);

export type MilkdropGpuVmSignals = Pick<
  MilkdropRuntimeSignals,
  'time' | 'frame' | 'fps'
> &
  Partial<Omit<MilkdropRuntimeSignals, 'time' | 'frame' | 'fps'>>;
