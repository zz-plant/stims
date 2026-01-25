export type ToyCapabilities = {
  microphone: boolean;
  demoAudio: boolean;
  motion: boolean;
};

const DEFAULT_CAPABILITIES: ToyCapabilities = {
  microphone: true,
  demoAudio: true,
  motion: false,
};

export function createToyCapabilities(
  overrides: Partial<ToyCapabilities> = {},
): ToyCapabilities {
  return {
    ...DEFAULT_CAPABILITIES,
    ...overrides,
  };
}

export function createMotionToyCapabilities(): ToyCapabilities {
  return createToyCapabilities({ motion: true });
}

export function withToyCapabilities<T extends Record<string, unknown>>(
  entry: T,
  capabilities: ToyCapabilities = createToyCapabilities(),
): T & { capabilities: ToyCapabilities } {
  return {
    ...entry,
    capabilities: { ...capabilities },
  };
}
