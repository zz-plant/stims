// Minimal surface of @strudel/web (ships untyped). Only the pieces the
// Strudel lab bridge uses are declared here.
declare module '@strudel/web' {
  export function initStrudel(options?: {
    prebake?: () => Promise<unknown>;
  }): Promise<unknown> | unknown;
  export function evaluate(code: string): Promise<unknown>;
  export function hush(): void;
  export function getAudioContext(): AudioContext;
  export function samples(source: string): Promise<unknown>;
}
