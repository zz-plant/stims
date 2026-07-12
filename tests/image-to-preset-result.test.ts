import { describe, expect, test } from 'bun:test';
import { resolveImageToPresetAction } from '../assets/js/frontend/BrowseSheetPanel.tsx';

describe('image-to-preset result handling', () => {
  test('opens generated milk source in the editor when the API returns source text', () => {
    expect(
      resolveImageToPresetAction({
        description: 'neon rings over a dark field',
        milkSource: '[preset00]\nwave_mode=1',
      }),
    ).toEqual({
      kind: 'generated-source',
      description: 'neon rings over a dark field',
      source: '[preset00]\nwave_mode=1',
      title: 'Image generated preset',
    });
  });

  test('selects a preset when the API returns an existing preset id', () => {
    expect(
      resolveImageToPresetAction({
        description: 'blue tunnel',
        presetId: 'community:blue-tunnel',
      }),
    ).toEqual({
      kind: 'preset-id',
      description: 'blue tunnel',
      presetId: 'community:blue-tunnel',
    });
  });
});
