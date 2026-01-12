export interface ToyInstance {
  /**
   * Cleans up all resources (audio, webgl, event listeners).
   * After calling this, the toy should not be used again.
   */
  dispose(): void;

  /**
   * Optional: Pauses the animation loop and audio processing.
   */
  pause?(): void;

  /**
   * Optional: Resumes the animation loop and audio processing.
   */
  resume?(): void;

  /**
   * Optional: Updates configuration parameters dynamically.
   */
  updateOptions?(options: Record<string, any>): void;
}

export interface ToyStartOptions {
  /**
   * The container element where the toy should render its canvas and UI.
   * If not provided, the toy may default to a full-screen behavior or throw an error depending on implementation.
   */
  container?: HTMLElement | null;

  /**
   * An optional existing canvas to use. If provided, the toy should likely respect its size or the container's size.
   */
  canvas?: HTMLCanvasElement | null;

  /**
   * Optional AudioContext to share across multiple toys or with the main app.
   */
  audioContext?: AudioContext;
}

/**
 * The standard function signature exported by a Toy module.
 */
export type ToyStartFunction = (
  options?: ToyStartOptions,
) => Promise<ToyInstance> | ToyInstance;
