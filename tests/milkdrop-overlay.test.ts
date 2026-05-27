import { afterEach, describe, expect, mock, test } from 'bun:test';
import { MilkdropOverlay } from '../assets/js/milkdrop/overlay.ts';

function createOverlay() {
  return new MilkdropOverlay({
    host: document.body,
    callbacks: {
      onSelectPreset: mock(),
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
}

describe('milkdrop overlay lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('toggleOpen and isOpen work correctly', () => {
    const overlay = createOverlay();
    expect(overlay.isOpen()).toBe(false);

    overlay.toggleOpen(true);
    expect(overlay.isOpen()).toBe(true);

    overlay.toggleOpen(false);
    expect(overlay.isOpen()).toBe(false);

    overlay.toggleOpen();
    expect(overlay.isOpen()).toBe(true);

    overlay.toggleOpen();
    expect(overlay.isOpen()).toBe(false);

    overlay.dispose();
  });

  test('openTab switches active tab and opens overlay', () => {
    const overlay = createOverlay();
    expect(overlay.isOpen()).toBe(false);
    expect(overlay.shouldRenderInspectorMetrics()).toBe(false);

    overlay.openTab('inspector');
    expect(overlay.shouldRenderInspectorMetrics()).toBe(true);
    expect(overlay.isOpen()).toBe(true);

    overlay.dispose();
  });

  test('editor tab does not trigger inspector metrics', () => {
    const overlay = createOverlay();
    overlay.openTab('editor');
    expect(overlay.shouldRenderInspectorMetrics()).toBe(false);
    expect(overlay.isOpen()).toBe(true);

    overlay.dispose();
  });
});

describe('milkdrop overlay OSD', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('showPresetOsd displays title and meta', () => {
    const overlay = createOverlay();
    overlay.showPresetOsd('Test Preset', 'By Author', 'webgpu');
    expect(document.body.textContent).toContain('Test Preset');
    expect(document.body.textContent).toContain('By Author');

    overlay.dispose();
  });

  test('setCurrentPresetTitle updates header label', () => {
    const overlay = createOverlay();
    overlay.setCurrentPresetTitle('Active Preset');
    expect(document.body.textContent).toContain('Active Preset');

    overlay.dispose();
  });

  test('setStatus shows and hides status message', () => {
    const overlay = createOverlay();
    overlay.setStatus('Something happened');

    const statusEl = document.querySelector('.milkdrop-overlay__status');
    expect(statusEl?.textContent).toBe('Something happened');
    expect(statusEl?.getAttribute('hidden')).toBeNull();

    overlay.setStatus('');
    expect(statusEl?.getAttribute('hidden')).not.toBeNull();

    overlay.dispose();
  });
});

describe('milkdrop overlay inspector metrics', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('shouldRenderInspectorMetrics reflects active tab', () => {
    const overlay = createOverlay();
    expect(overlay.shouldRenderInspectorMetrics()).toBe(false);

    overlay.openTab('inspector');
    expect(overlay.shouldRenderInspectorMetrics()).toBe(true);

    overlay.openTab('editor');
    expect(overlay.shouldRenderInspectorMetrics()).toBe(false);

    overlay.dispose();
  });

  test('setInspectorState updates inspector panel content', () => {
    const overlay = createOverlay();
    overlay.openTab('inspector');

    const section = document.querySelector('.milkdrop-overlay__inspector-selection');
    expect(section).not.toBeNull();

    overlay.setInspectorState({});

    overlay.dispose();
  });
});

describe('milkdrop overlay compact toggle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('can omit the floating controls toggle when the shell owns tool entry', () => {
    const overlay = new MilkdropOverlay({
      host: document.body,
      showToggle: false,
      callbacks: {
        onSelectPreset: mock(),
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

    expect(document.querySelector('.milkdrop-overlay__toggle')).toBeNull();
    expect(document.querySelector('.milkdrop-overlay__panel')).not.toBeNull();

    overlay.dispose();
  });
});
