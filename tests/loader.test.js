/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import {
  loadToy,
  resetModuleImporter,
  setModuleImporter,
} from '../assets/js/loader.js';

describe('loadToy', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ slug: 'brand', module: './toy.html?toy=brand' }]),
      })
    );
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: 'http://localhost/' },
    });
    resetModuleImporter();
  });

  test('navigates to HTML toy page', async () => {
    await loadToy('brand');
    expect(window.location.href).toBe('./brand.html');
  });

  test('starts audio after importing a module toy', async () => {
    const startAudio = jest.fn().mockResolvedValue();

    setModuleImporter(async () => {
      window.startAudio = startAudio;
      return {};
    });

    await loadToy('cube-wave');

    expect(startAudio).toHaveBeenCalledTimes(1);
    const button = document.getElementById('start-audio-btn');
    expect(button?.style.display).toBe('none');
  });
});
