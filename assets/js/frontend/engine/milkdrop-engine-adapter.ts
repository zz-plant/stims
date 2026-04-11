import { createMilkdropEngineAdapter as createMilkdropEngineAdapterImpl } from './milkdrop-engine-session.ts';

export type { EngineSnapshot } from './engine-snapshot.ts';

export const createMilkdropEngineAdapter = createMilkdropEngineAdapterImpl;

export type MilkdropEngineAdapter = ReturnType<
  typeof createMilkdropEngineAdapter
>;
