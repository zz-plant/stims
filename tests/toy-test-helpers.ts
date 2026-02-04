import { mock } from 'bun:test';

export class FakeAnalyserNode {
  frequencyBinCount: number;
  connected = false;

  constructor(frequencyBinCount = 16) {
    this.frequencyBinCount = frequencyBinCount;
  }

  connect(_destination?: unknown) {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  getByteFrequencyData(array: Uint8Array) {
    array.fill(128);
  }
}

export class FakeAudioContext {
  closed = false;
  analyzersCreated = 0;
  private readonly buildAnalyser: () => FakeAnalyserNode;

  constructor(options: { analyserFactory?: () => FakeAnalyserNode } = {}) {
    this.buildAnalyser =
      options.analyserFactory ?? (() => new FakeAnalyserNode());
  }

  createAnalyser() {
    this.analyzersCreated += 1;
    return this.buildAnalyser();
  }

  async close() {
    this.closed = true;
  }
}

export function createToyContainer(id = 'toy-container') {
  const container = document.createElement('div');
  container.id = id;
  document.body.appendChild(container);

  const dispose = () => {
    container.remove();
  };

  return { container, dispose };
}

export function createMockRenderer() {
  const render = mock((payload?: unknown) => payload);
  const dispose = mock(() => {});

  const renderFrame = (payload?: unknown) => render(payload);

  return { render, dispose, renderFrame };
}
