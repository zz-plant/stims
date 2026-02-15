import type { LightType } from './lighting';

export type StatusVariant = 'info' | 'error';

export type LightsUIElements = {
  startButton: HTMLButtonElement | null;
  fallbackButton: HTMLButtonElement | null;
  statusElement: HTMLElement | null;
  lightSelect: HTMLSelectElement | null;
};

export type LightsUI = {
  elements: LightsUIElements;
  setStatus: (message: string, variant?: StatusVariant) => void;
  getSelectedLightType: () => LightType;
  bindLightTypeChange: (
    handler: (lightType: LightType) => void,
  ) => (() => void) | undefined;
};

export const createLightsUI = (root: ParentNode | null): LightsUI => {
  const elements: LightsUIElements = {
    startButton: root?.querySelector(
      '#start-audio-btn',
    ) as HTMLButtonElement | null,
    fallbackButton: root?.querySelector(
      '#use-demo-audio',
    ) as HTMLButtonElement | null,
    statusElement: root?.querySelector('#audio-status') as HTMLElement | null,
    lightSelect: root?.querySelector('#light-type') as HTMLSelectElement | null,
  };

  const setStatus = (message: string, variant: StatusVariant = 'info') => {
    if (!elements.statusElement) return;
    elements.statusElement.textContent = message;
    elements.statusElement.dataset.variant = variant;
    elements.statusElement.hidden = !message;
  };

  const getSelectedLightType = (): LightType => {
    if (elements.lightSelect) {
      return elements.lightSelect.value as LightType;
    }
    return 'PointLight';
  };

  const bindLightTypeChange = (handler: (lightType: LightType) => void) => {
    if (!elements.lightSelect) return undefined;
    const listener = () => handler(getSelectedLightType());
    elements.lightSelect.addEventListener('change', listener);
    return () => {
      elements.lightSelect?.removeEventListener('change', listener);
    };
  };

  return {
    elements,
    setStatus,
    getSelectedLightType,
    bindLightTypeChange,
  };
};
