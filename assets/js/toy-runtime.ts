export interface ToyInstance {
  dispose?: () => void;
}

export interface ToyStartOptions {
  container?: HTMLElement | null;
  slug: string;
}

export type ToyStartResult = ToyInstance | void | null | undefined;
export type ToyStarter = (options: ToyStartOptions) => ToyStartResult | Promise<ToyStartResult>;

export function normalizeToyInstance(candidate: unknown): ToyInstance | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const dispose = (candidate as { dispose?: unknown }).dispose;
  if (dispose !== undefined && typeof dispose !== 'function') {
    return null;
  }

  return candidate as ToyInstance;
}
