import { describe, expect, mock, test } from 'bun:test';
import { searchByAudioProfile } from '../assets/js/core/services/audio-matcher.ts';
import { resolveOptionalApiUrl } from '../assets/js/core/services/optional-api.ts';

describe('optional API endpoint resolution', () => {
  test('does not call same-origin Cloudflare Functions from plain Vite dev', async () => {
    const fetchMock = mock();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const results = await searchByAudioProfile({
        bassEnergy: 0.2,
        midEnergy: 0.1,
        trebleEnergy: 0.05,
        beatIntensity: 1,
        rms: 0.08,
        centroid: 1200,
      });

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses an explicit API base when one is configured', () => {
    expect(
      resolveOptionalApiUrl('/api/visual-search', {
        env: {
          DEV: true,
          VITE_STIMS_API_BASE: 'https://toil.fyi/api',
        },
        location: new URL('http://localhost:5173/'),
      }),
    ).toBe('https://toil.fyi/api/visual-search');
  });

  test('uses same-origin APIs in production builds', () => {
    expect(
      resolveOptionalApiUrl('/api/visual-search', {
        env: { DEV: false },
        location: new URL('https://toil.fyi/'),
      }),
    ).toBe('https://toil.fyi/api/visual-search');
  });
});
