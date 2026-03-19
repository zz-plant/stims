import { compileMilkdropPresetSource } from './compiler';
import type {
  MilkdropFidelityMode,
  MilkdropParityAllowlistEntry,
  MilkdropPresetSource,
} from './types';

type CompileRequest = {
  id: number;
  type: 'compile';
  source: string;
  preset: Partial<MilkdropPresetSource>;
  fidelityMode: MilkdropFidelityMode;
  parityAllowlist: MilkdropParityAllowlistEntry[];
};

type CompileResponse = {
  id: number;
  compiled: ReturnType<typeof compileMilkdropPresetSource>;
};

self.addEventListener('message', (event: MessageEvent<CompileRequest>) => {
  const payload = event.data;
  if (!payload || payload.type !== 'compile') {
    return;
  }

  const compiled = compileMilkdropPresetSource(payload.source, payload.preset, {
    fidelityMode: payload.fidelityMode,
    parityAllowlist: payload.parityAllowlist,
  });
  const response: CompileResponse = {
    id: payload.id,
    compiled,
  };
  self.postMessage(response);
});
