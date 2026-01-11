import { mock } from 'bun:test';

export class FakeAnalyserNode {
  frequencyBinCount: number;
  connected = false;

  constructor(frequencyBinCount = 16) {
    this.frequencyBinCount = frequencyBinCount;
  }

  connect() {
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

  createAnalyser() {
    this.analyzersCreated += 1;
    return new FakeAnalyserNode();
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
    document.body.innerHTML = '';
  };

  return { container, dispose };
}

export function createMockRenderer() {
  const render = mock((payload?: unknown) => payload);
  const dispose = mock(() => {});

  const renderFrame = (payload?: unknown) => render(payload);

  return { render, dispose, renderFrame };
}
