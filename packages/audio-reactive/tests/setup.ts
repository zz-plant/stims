/**
 * Minimal fake AudioWorkletGlobalScope so `frequency-analyser-processor.ts`
 * can be imported under Bun. The processor extends `AudioWorkletProcessor`
 * and calls `registerProcessor` at module top level, so both must exist
 * before the import; `sampleRate` and `currentTime` are read inside the
 * class. Nothing here touches the DOM.
 */

export type PostedMessage = [
  payload: Record<string, unknown>,
  transfers: Transferable[] | undefined,
];

export class FakeMessagePort {
  readonly posted: PostedMessage[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(message: unknown, transfers?: Transferable[]): void {
    this.posted.push([message as Record<string, unknown>, transfers]);
  }
}

export class FakeAudioWorkletProcessor {
  readonly port = new FakeMessagePort();
}

export const registeredProcessors = new Map<string, unknown>();

const scope = globalThis as unknown as {
  AudioWorkletProcessor?: unknown;
  registerProcessor?: (name: string, ctor: unknown) => void;
  sampleRate?: number;
  currentTime?: number;
};

scope.AudioWorkletProcessor ??= FakeAudioWorkletProcessor;
scope.registerProcessor ??= (name, ctor) => {
  registeredProcessors.set(name, ctor);
};
scope.sampleRate ??= 48_000;
scope.currentTime ??= 0;
