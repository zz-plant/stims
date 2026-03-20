import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_QUALITY_PRESETS } from '../assets/js/core/settings-panel.ts';
import { MilkdropOverlay } from '../assets/js/milkdrop/overlay.ts';

describe('milkdrop overlay quality controls', () => {
  const OriginalMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  test('renders quality controls inside browse and reports changes', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const onSelectQualityPreset = mock();
    const overlay = new MilkdropOverlay({
      host: document.body,
      callbacks: {
        onSelectPreset: mock(),
        onSelectQualityPreset,
        onToggleFavorite: mock(),
        onSetRating: mock(),
        onToggleAutoplay: mock(),
        onTransitionModeChange: mock(),
        onGoBackPreset: mock(),
        onNextPreset: mock(),
        onPreviousPreset: mock(),
        onRandomize: mock(),
        onBlendDurationChange: mock(),
        onImportFiles: mock(),
        onExport: mock(),
        onDuplicatePreset: mock(),
        onDeletePreset: mock(),
        onEditorSourceChange: mock(),
        onRevertToActive: mock(),
        onInspectorFieldChange: mock(),
      },
    });

    overlay.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      activePresetId: 'balanced',
      storageKey: 'stims:milkdrop:quality',
    });

    const select = document.querySelector(
      '.milkdrop-overlay__quality-select',
    ) as HTMLSelectElement | null;

    expect(select).not.toBeNull();
    expect(select?.value).toBe('balanced');
    expect(document.body.textContent).toContain(
      'Saved on this device for this toy profile.',
    );

    if (select) {
      select.value = 'tv';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(onSelectQualityPreset).toHaveBeenCalledWith('tv');
    expect(document.body.textContent).toContain(
      'Comfortable 10-foot visuals with softer density and steadier frame pacing.',
    );

    overlay.dispose();
  });
});
