import { afterEach, describe, expect, mock, test } from 'bun:test';
import { MilkdropOverlay } from '../../src/js/milkdrop/overlay.ts';

function createOverlay() {
  return new MilkdropOverlay({
    host: document.body,
    callbacks: {
      onToggleAutoplay: mock(),
      onTransitionModeChange: mock(),
      onNextPreset: mock(),
      onPreviousPreset: mock(),
      onBlendDurationChange: mock(),
    },
  });
}

describe('milkdrop overlay OSD', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('showPresetOsd displays title, meta, and backend', () => {
    const overlay = createOverlay();
    overlay.showPresetOsd('Test Preset', 'By Author', 'webgpu');
    expect(document.body.textContent).toContain('Test Preset');
    expect(document.body.textContent).toContain('By Author');
    expect(document.body.textContent).toContain('webgpu');
    overlay.dispose();
  });

  test('setCurrentPresetTitle updates header', () => {
    const overlay = createOverlay();
    overlay.setCurrentPresetTitle('Active Preset');
    expect(document.body.textContent).toContain('Active Preset');
    overlay.dispose();
  });
});

describe('milkdrop overlay status', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('setStatus shows and hides status message', () => {
    const overlay = createOverlay();
    overlay.setStatus('Something happened');
    expect(document.body.textContent).toContain('Something happened');
    overlay.setStatus('');
    expect(document.body.textContent).not.toContain('Something happened');
    overlay.dispose();
  });
});

describe('milkdrop overlay controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('setAutoplay checks toggle', () => {
    const overlay = createOverlay();
    overlay.setAutoplay(true);
    const cb = document.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(cb?.checked).toBe(true);
    overlay.dispose();
  });

  test('setTransitionMode selects correct option', () => {
    const overlay = createOverlay();
    overlay.setTransitionMode('cut');
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select?.value).toBe('cut');
    overlay.dispose();
  });

  test('setBlendDuration updates slider and label', () => {
    const overlay = createOverlay();
    overlay.setBlendDuration(1.5);
    const slider = document.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider?.value).toBe('1.5');
    expect(document.body.textContent).toContain('1.50s');
    overlay.dispose();
  });
});

describe('milkdrop overlay transport', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('prev button fires callback', () => {
    const onPrev = mock();
    const overlay = new MilkdropOverlay({
      host: document.body,
      callbacks: {
        onToggleAutoplay: mock(),
        onTransitionModeChange: mock(),
        onNextPreset: mock(),
        onPreviousPreset: onPrev,
        onBlendDurationChange: mock(),
      },
    });
    const buttons = document.querySelectorAll('button');
    const prevBtn = Array.from(buttons).find((b) => b.textContent === 'Prev');
    prevBtn?.click();
    expect(onPrev).toHaveBeenCalled();
    overlay.dispose();
  });

  test('next button fires callback', () => {
    const onNext = mock();
    const overlay = new MilkdropOverlay({
      host: document.body,
      callbacks: {
        onToggleAutoplay: mock(),
        onTransitionModeChange: mock(),
        onNextPreset: onNext,
        onPreviousPreset: mock(),
        onBlendDurationChange: mock(),
      },
    });
    const buttons = document.querySelectorAll('button');
    const nextBtn = Array.from(buttons).find((b) => b.textContent === 'Next');
    nextBtn?.click();
    expect(onNext).toHaveBeenCalled();
    overlay.dispose();
  });
});

describe('milkdrop overlay dispose', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('dispose removes root element', () => {
    const overlay = createOverlay();
    expect(document.querySelector('.milkdrop-overlay')).not.toBeNull();
    overlay.dispose();
    expect(document.querySelector('.milkdrop-overlay')).toBeNull();
  });
});
