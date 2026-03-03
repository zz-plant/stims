import { describe, expect, mock, test } from 'bun:test';
import { createHapticsController } from '../assets/js/loader/haptics.ts';

describe('haptics controller', () => {
  test('persists and toggles haptics state', () => {
    const setItem = mock((_k: string, _v: string) => {});
    const trigger = mock(
      (_pattern?: number | number[] | Array<{ duration: number }>) =>
        Promise.resolve(),
    );
    const controller = createHapticsController({
      isPartyModeActive: () => false,
      hapticEngine: {
        isSupported: true,
        trigger,
        cancel: mock(() => {}),
      },
      navigatorRef: () => ({ userAgent: 'iPhone' }) as unknown as Navigator,
      documentRef: () =>
        ({ body: { dataset: { audioActive: 'true' } } }) as unknown as Document,
      windowRef: () =>
        ({
          localStorage: { setItem, getItem: () => 'false' },
          addEventListener: mock(() => {}),
          removeEventListener: mock(() => {}),
        }) as unknown as Window,
    });

    controller.setHapticsEnabled(true);
    expect(controller.getHapticsEnabled()).toBe(true);
    expect(setItem).toHaveBeenCalledWith('stims:haptics-enabled', 'true');

    controller.pulseHaptics(0.5);
    expect(trigger).toHaveBeenCalled();
  });
});
