import { describe, expect, test } from 'bun:test';
import type { ToyManifest } from '../assets/js/data/toy-schema.ts';
import { getStimBuilderRecommendations } from '../assets/js/utils/stim-builder.ts';

const toys: ToyManifest = [
  {
    slug: 'touch-calm',
    title: 'Touch Calm',
    description: 'Gentle touch toy',
    module: '/touch-calm',
    type: 'module',
    featuredRank: 2,
    moods: ['calming'],
    tags: ['touch', 'gestural'],
    capabilities: { microphone: false, demoAudio: true, motion: false },
  },
  {
    slug: 'motion-hype',
    title: 'Motion Hype',
    description: 'Energy toy',
    module: '/motion-hype',
    type: 'module',
    featuredRank: 3,
    moods: ['energetic'],
    tags: ['tilt'],
    capabilities: { microphone: true, demoAudio: true, motion: true },
    requiresWebGPU: true,
  },
  {
    slug: 'balanced-demo',
    title: 'Balanced Demo',
    description: 'Balanced starter',
    module: '/balanced-demo',
    type: 'module',
    featuredRank: 1,
    moods: ['playful'],
    tags: ['patterns'],
    capabilities: { microphone: true, demoAudio: true, motion: false },
  },
];

describe('stim builder recommendations', () => {
  test('prefers motion and microphone matches for intense profile', () => {
    const picks = getStimBuilderRecommendations(toys, {
      mood: 'energetic',
      energy: 'intense',
      interaction: 'motion',
      audio: 'microphone',
      renderer: 'webgpu',
    });

    expect(picks[0]?.toy.slug).toBe('motion-hype');
  });

  test('prefers calm touch toys for soft profile', () => {
    const picks = getStimBuilderRecommendations(toys, {
      mood: 'calming',
      energy: 'soft',
      interaction: 'touch',
      audio: 'demoAudio',
      renderer: 'webgl',
    });

    expect(picks[0]?.toy.slug).toBe('touch-calm');
  });
});
