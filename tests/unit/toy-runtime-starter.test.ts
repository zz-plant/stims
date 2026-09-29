import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getSettingsPanel } from '../../src/js/core/settings-panel.ts';

const freshImport = async () =>
  import(
    `../../src/js/core/toy-runtime-starter.ts?ts=${Date.now()}-${Math.random()}`
  );

// `mock.restore()` does not undo `mock.module()`: the stub below outlives this
// file and is served to any later test in the same worker that imports
// `toy-runtime` (toy-runtime-preview-loop then got `{ runtime: true }` for a
// real runtime and failed with "startAudio is not a function", but only when
// the runner happened to put the two files in one worker). Capture the real
// module before the first mock and put it back afterwards.
const TOY_RUNTIME_PATH = '../../src/js/core/toy-runtime';
// Bun patches an already-imported module's exports in place, so the namespace
// object itself would be overwritten by the stub: copy the values.
const realToyRuntime = { ...(await import(`${TOY_RUNTIME_PATH}.ts`)) };

describe('toy runtime starter', () => {
  const createToyRuntime = mock(() => ({ runtime: true }));
  const configureQualityPresets = mock(() => panel);
  let configure: ReturnType<typeof mock>;
  let panel: ReturnType<typeof getSettingsPanel>;

  beforeEach(() => {
    mock.restore();
    document.body.innerHTML = '';
    panel = getSettingsPanel();
    configure = mock(panel.configure.bind(panel));
    panel.configure = configure;
    mock.module('../../src/js/core/toy-runtime', () => ({
      createToyRuntime,
    }));
  });

  afterEach(() => {
    mock.restore();
    mock.module(TOY_RUNTIME_PATH, () => realToyRuntime);
  });

  test('configures the shared settings panel when starter settings are provided', async () => {
    const { createToyRuntimeStarter } = await freshImport();
    const start = createToyRuntimeStarter({
      settingsPanel: {
        title: 'MilkDrop',
        description: 'Live preset controls',
        quality: {
          activeQuality: { id: 'balanced' },
          applyQualityPreset: mock(),
          configureQualityPresets,
        },
      },
    });
    const container = document.createElement('div');

    const result = start({ container });

    expect(createToyRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        canvas: undefined,
      }),
    );
    expect(configure).toHaveBeenCalledWith({
      title: 'MilkDrop',
      description: 'Live preset controls',
    });
    expect(configureQualityPresets).toHaveBeenCalledWith(panel);
    expect(result).toEqual({ runtime: true });
  });
});
