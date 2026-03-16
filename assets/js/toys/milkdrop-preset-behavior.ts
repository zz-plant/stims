import type { PersistentSettingsPanel } from '../core/settings-panel';
import type { ToyRuntimeFrame, ToyRuntimeOptions } from '../core/toy-runtime';
import type {
  MilkdropCompiledPreset,
  MilkdropRuntimeSignals,
} from '../milkdrop/types';

export type MilkdropPresetFieldValue = number | string;

export type MilkdropPresetToyBehaviorApi = {
  readonly presetId: string;
  getActivePresetId: () => string | null;
  getActiveCompiledPreset: () => MilkdropCompiledPreset | null;
  applyFields: (
    updates: Record<string, MilkdropPresetFieldValue>,
  ) => Promise<void>;
  selectPreset: (id: string) => Promise<void>;
  setStatus: (message: string) => void;
};

export type MilkdropPresetToyBehaviorContext = {
  frame: ToyRuntimeFrame;
  api: MilkdropPresetToyBehaviorApi;
};

export type MilkdropPresetToyBehaviorInstance = {
  input?: ToyRuntimeOptions['input'];
  getSignalOverrides?: (
    context: MilkdropPresetToyBehaviorContext,
  ) => Partial<MilkdropRuntimeSignals>;
  onFrame?: (context: MilkdropPresetToyBehaviorContext) => void;
  setupPanel?: (
    panel: PersistentSettingsPanel,
    api: MilkdropPresetToyBehaviorApi,
  ) => void;
  dispose?: () => void;
};

export type MilkdropPresetToyBehaviorFactory =
  () => MilkdropPresetToyBehaviorInstance;
