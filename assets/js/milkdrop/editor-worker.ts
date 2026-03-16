import { compileMilkdropPresetSource } from './compiler';
import type { MilkdropPresetSource } from './types';

type CompileRequest = {
  id: number;
  type: 'compile';
  source: string;
  preset: Partial<MilkdropPresetSource>;
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

  const compiled = compileMilkdropPresetSource(payload.source, payload.preset);
  const response: CompileResponse = {
    id: payload.id,
    compiled,
  };
  self.postMessage(response);
});
