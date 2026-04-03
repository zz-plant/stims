import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createToyView } from '../assets/js/toy-view.ts';

describe('toy view helpers', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.focusedSession;
    document.body.innerHTML = '<div id="toy-list"></div>';
  });

  afterEach(() => {
    delete document.documentElement.dataset.focusedSession;
    document.body.innerHTML = '';
  });

  test('shows active view and registers back control once', () => {
    const view = createToyView();
    const onBack = mock();

    const stage = view.showActiveToyView(onBack, {
      slug: 'demo',
      title: 'Demo Toy',
    });
    const container = document.getElementById('active-toy-container');

    expect(stage?.dataset.stageSlot).toBe('primary');
    expect(container?.classList.contains('is-hidden')).toBe(false);
    const backControl = container?.querySelector('[data-back-to-library]');
    expect(backControl).not.toBeNull();
    expect(container?.querySelectorAll('[data-back-to-library]')).toHaveLength(
      1,
    );
    expect(
      container?.querySelector('.active-toy-nav__title')?.textContent,
    ).toBe('Demo Toy');

    backControl?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('renders capability error with recovery and exit actions', () => {
    const view = createToyView();
    const onBack = mock();
    const onBrowseCompatible = mock();

    const status = view.showCapabilityError(
      { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      { onBack, onBrowseCompatible },
    );

    expect(status?.classList.contains('is-error')).toBe(true);

    const buttons = status?.querySelectorAll('button');
    expect(buttons?.length).toBe(2);

    buttons?.[0].dispatchEvent(new Event('click', { bubbles: true }));
    buttons?.[1].dispatchEvent(new Event('click', { bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBrowseCompatible).toHaveBeenCalledTimes(1);
  });

  test('renders preferred renderer recovery action when available', () => {
    const view = createToyView();
    const onUsePreferredRenderer = mock();

    const status = view.showCapabilityError(
      { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      {
        preferredRendererActionLabel: 'Use WebGPU',
        onUsePreferredRenderer,
        onBack: mock(),
      },
    );

    expect(status?.querySelector('h2')?.textContent).toContain(
      'WebGPU not available',
    );
    const buttons = status?.querySelectorAll('button');
    expect(buttons?.length).toBe(2);
    expect(buttons?.[0]?.textContent).toContain('Use WebGPU');

    buttons?.[0].dispatchEvent(new Event('click', { bubbles: true }));
    expect(onUsePreferredRenderer).toHaveBeenCalledTimes(1);
  });

  test('marks the active toy container when a blocking status is visible', () => {
    const view = createToyView();

    view.showCapabilityError(
      { slug: 'webgpu-toy', title: 'Fancy WebGPU' },
      { onBack: mock() },
    );

    const container = document.getElementById('active-toy-container');
    expect(container?.dataset.hasBlockingStatus).toBe('true');
  });

  test('renders import error message for TypeScript modules', () => {
    const view = createToyView();
    const status = view.showImportError(
      { slug: 'import-error', title: 'Broken Toy' },
      { moduleUrl: 'assets/js/toys/broken.ts' },
    );

    expect(status?.textContent).toContain('could not start on this setup yet');
    expect(
      status?.querySelector('.active-toy-status__actions button'),
    ).not.toBeNull();
  });

  test('rebuilds the floating audio prompt after container content is cleared', () => {
    const view = createToyView();
    view.showActiveToyView();
    view.showAudioPrompt(true, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterTips: ['Try demo first'],
    });

    expect(document.querySelector('.control-panel')).not.toBeNull();

    view.clearActiveToyContainer();
    expect(document.querySelector('.control-panel')).toBeNull();

    view.setRendererStatus({ backend: 'webgpu' });
    expect(document.querySelector('.control-panel')).not.toBeNull();
  });

  test('removes the floating audio prompt when disabled', () => {
    const view = createToyView();
    view.showActiveToyView();
    view.showAudioPrompt(true, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    expect(document.querySelector('.control-panel')).not.toBeNull();

    view.showAudioPrompt(false);
    expect(document.querySelector('.control-panel')).toBeNull();
  });

  test('marks the active toy container when the audio prompt HUD is active', () => {
    const view = createToyView();

    view.showActiveToyView();
    view.showAudioPrompt(true, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const container = document.getElementById('active-toy-container');
    expect(container?.dataset.audioPromptActive).toBe('true');

    view.showAudioPrompt(false);
    expect(container?.dataset.audioPromptActive).toBe('false');
  });

  test('suppresses the floating audio prompt while launch-shell controls are visible', () => {
    document.documentElement.dataset.focusedSession = 'launch';
    const shellControls = document.createElement('div');
    shellControls.dataset.audioControls = 'true';
    document.body.appendChild(shellControls);

    const view = createToyView();
    view.showActiveToyView();
    view.showAudioPrompt(true, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const container = document.getElementById('active-toy-container');
    expect(container?.dataset.audioPromptActive).toBe('true');
    expect(container?.querySelector('.control-panel')).toBeNull();

    delete document.documentElement.dataset.focusedSession;
  });

  test('prepares and completes staged toy transitions', async () => {
    const view = createToyView();
    const currentStage = view.showActiveToyView(undefined, {
      slug: 'one',
      title: 'One',
    });
    const currentToy = document.createElement('div');
    currentToy.dataset.toy = 'current';
    currentStage?.appendChild(currentToy);

    const incomingStage = view.showIncomingToyView(undefined, {
      slug: 'two',
      title: 'Two',
    });
    const incomingToy = document.createElement('div');
    incomingToy.dataset.toy = 'incoming';
    incomingStage?.appendChild(incomingToy);

    expect(currentStage?.dataset.stageSlot).toBe('primary');
    expect(incomingStage?.dataset.stageSlot).toBe('secondary');
    expect(document.querySelector('[data-toy="current"]')).not.toBeNull();
    expect(document.querySelector('[data-toy="incoming"]')).not.toBeNull();

    await view.completeToyTransition();

    expect(document.querySelector('[data-toy="current"]')).toBeNull();
    expect(document.querySelector('[data-toy="incoming"]')).not.toBeNull();
  });
});
