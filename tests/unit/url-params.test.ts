import { describe, expect, it } from 'bun:test';
import {
  getMockAudioParams,
  getPerformanceOverrideParams,
  getRequestedCorpus,
  getRequestedRenderer,
  getSmartTvOverride,
  isAgentMode,
  normalizeCollectionTag,
  parseURLParams,
} from '../../src/js/core/url-params.ts';

describe('url-params', () => {
  it('parses routing parameters correctly', () => {
    const parsed = parseURLParams(
      '?preset=custom-preset&collection=chill&tool=editor&audio=mic&agent=true&embedded=true',
    );

    expect(parsed.routing.presetId).toBe('custom-preset');
    expect(parsed.routing.collectionTag).toBe('collection:chill');
    expect(parsed.routing.panel).toBe('editor');
    expect(parsed.routing.audioSource).toBe('microphone');
    expect(parsed.routing.agentMode).toBe(true);
    expect(parsed.routing.previewMode).toBe(true);
  });

  it('handles legacy aliases correctly', () => {
    const parsed = parseURLParams('?tool=looks&audio=sample');
    expect(parsed.routing.panel).toBe('browse');
    expect(parsed.routing.audioSource).toBe('demo');
  });

  it('parses renderer and corpus overrides', () => {
    expect(getRequestedRenderer('?renderer=webgpu')).toBe('webgpu');
    expect(getRequestedRenderer('?renderer=webgl')).toBe('webgl');
    expect(getRequestedRenderer('?renderer=invalid')).toBe(null);
    expect(getRequestedCorpus('?corpus=certification')).toBe('certification');
  });

  it('parses agent mode safely without fragile substring matching', () => {
    expect(isAgentMode('?agent=true')).toBe(true);
    expect(isAgentMode('?notagent=true')).toBe(false);
    expect(isAgentMode('?agent=false')).toBe(false);
  });

  it('parses performance parameters', () => {
    const perf = getPerformanceOverrideParams(
      '?maxPixelRatio=1.5&particleBudget=5000&shaderQuality=high',
    );
    expect(perf.maxPixelRatio).toBe(1.5);
    expect(perf.particleBudget).toBe(5000);
    expect(perf.shaderQuality).toBe('high');
  });

  it('parses mock audio parameters', () => {
    const audio = getMockAudioParams('?mockAudio=sample&mockFrequency=440');
    expect(audio.type).toBe('sample');
    expect(audio.frequency).toBe(440);
  });

  it('parses smart TV parameter aliases', () => {
    expect(getSmartTvOverride('?tv=samsung')).toBe('samsung');
    expect(getSmartTvOverride('?tvMode=lg')).toBe('lg');
  });

  it('normalizes collection tags correctly', () => {
    expect(normalizeCollectionTag('favorites')).toBe('collection:favorites');
    expect(normalizeCollectionTag('collection:top')).toBe('collection:top');
    expect(normalizeCollectionTag(null)).toBe(null);
  });
});
