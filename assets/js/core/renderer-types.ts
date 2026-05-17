export type RenderScale = number & { __brand: 'RenderScale' };

export function createRenderScale(value: number): RenderScale {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid render scale: ${value}. Must be a positive finite number.`,
    );
  }
  return value as RenderScale;
}

export function isRenderScale(value: unknown): value is RenderScale {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
