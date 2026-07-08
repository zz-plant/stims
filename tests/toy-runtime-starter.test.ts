import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getSettingsPanel } from '../assets/js/core/settings-panel.ts';

const freshImport = async () =>
  import(
    `../assets/js/core/toy-runtime-starter.ts?ts=${Date.now()}-${Math.random()}`
  );

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
    mock.module('../assets/js/core/toy-runtime', () => ({
      createToyRuntime,
    }));
  });

  afterEach(() => {
    mock.restore();
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
