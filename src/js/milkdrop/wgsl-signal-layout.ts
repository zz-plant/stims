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
] as const;

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
