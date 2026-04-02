import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const freshImport = async () =>
  import(`../assets/js/toys/milkdrop-toy.ts?ts=${Date.now()}-${Math.random()}`);

describe('milkdrop toy runtime boundary', () => {
  const createRendererQualityManager = mock(() => ({
    kind: 'quality-manager',
  }));
  const attachRuntime = mock();
  const update = mock();
  const dispose = mock();
  const createMilkdropExperience = mock(() => ({
    attachRuntime,
    update,
    dispose,
  }));
  const runtime = {
    dispose: mock(),
    toy: { id: 'toy' },
    startAudio: mock(),
    addPlugin: mock(),
    getInputState: mock(),
    getPerformanceSettings: mock(),
  };
  const startRuntime = mock(() => runtime);
  const createToyRuntimeStarter = mock(() => startRuntime);

  beforeEach(() => {
    mock.restore();
    mock.module('../assets/js/core/toy-quality', () => ({
      createRendererQualityManager,
    }));
    mock.module('../assets/js/milkdrop/runtime', () => ({
      createMilkdropExperience,
    }));
    mock.module('../assets/js/core/toy-runtime-starter', () => ({
      createToyRuntimeStarter,
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test('wires the MilkDrop experience through the shared toy runtime starter', async () => {
    const { start } = await freshImport();
    const container = document.createElement('div');

    const result = start({ container });

    expect(createRendererQualityManager).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPresetId: 'balanced',
        storageKey: 'stims:milkdrop:quality',
      }),
    );
    expect(createMilkdropExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        quality: { kind: 'quality-manager' },
        qualityControl: expect.objectContaining({
          storageKey: 'stims:milkdrop:quality',
        }),
      }),
    );
    expect(createToyRuntimeStarter).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: { fftSize: 512 },
        plugins: [
          expect.objectContaining({
            name: 'milkdrop-experience',
          }),
        ],
      }),
    );
    expect(startRuntime).toHaveBeenCalledWith({ container });
    expect(result).toBe(runtime);

    const starterCall = (
      createToyRuntimeStarter as unknown as {
        mock: { calls: Array<[unknown?]> };
      }
    ).mock.calls[0] as
      | [
          {
            plugins?: Array<{
              setup: (runtime: unknown) => void;
              update: (frame: unknown) => void;
              dispose: () => void;
            }>;
          },
        ]
      | undefined;
    const starterArgs = starterCall?.[0];
    const [plugin] = starterArgs?.plugins ?? [];
    plugin.setup(runtime);
    plugin.update({ frame: 1 });
    plugin.dispose();

    expect(attachRuntime).toHaveBeenCalledWith(runtime);
    expect(update).toHaveBeenCalledWith({ frame: 1 });
    expect(dispose).toHaveBeenCalled();
  });
});
