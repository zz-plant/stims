import { afterEach, describe, expect, test } from 'bun:test';
import { start as startDemoToy } from './demo-toy.ts';
import {
  createMockRenderer,
  createToyContainer,
  FakeAudioContext,
} from './toy-test-helpers.ts';

describe('toy harness example', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('runs demo toy with shared stubs and cleans up DOM', async () => {
    const { container, dispose } = createToyContainer('demo-toy-root');
    const audioContext = new FakeAudioContext();
    const initialBodyChildren = document.body.childElementCount;

    const cleanup = startDemoToy({ container, audioContext });

    expect(typeof cleanup).toBe('function');
    expect(
      container.querySelector('[data-toy-mount="demo-toy"]'),
    ).not.toBeNull();

    await cleanup();

    expect(container.childElementCount).toBe(0);
    expect(document.querySelector('[data-toy-mount="demo-toy"]')).toBeNull();
    expect(document.body.childElementCount).toBe(initialBodyChildren);
    expect(audioContext.closed).toBe(true);

    dispose();
    expect(document.body.childElementCount).toBe(0);
  });

  test('exposes reusable helpers for analyzers and renderers', () => {
    const renderer = createMockRenderer();
    renderer.renderFrame({ frame: 1 });
    renderer.renderFrame({ frame: 2 });

    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.render).toHaveBeenLastCalledWith({ frame: 2 });

    const audioContext = new FakeAudioContext();
    const analyser = audioContext.createAnalyser();
    const samples = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(samples);

    expect(Array.from(samples)).toEqual(
      new Array(analyser.frequencyBinCount).fill(128),
    );
  });
});
