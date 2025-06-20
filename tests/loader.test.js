/** @jest-environment node */
import { jest } from '@jest/globals';
import { loadToy } from '../assets/js/loader.js';

describe('loadToy', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([{ slug: 'brand', module: './toy.html?toy=brand' }]),
      })
    );
    global.window = { location: { href: '' } };
  });

  test('navigates to HTML toy page', async () => {
    await loadToy('brand');
    expect(window.location.href).toBe('./brand.html');
  });
});
