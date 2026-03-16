import { createCosmicParticlesBehavior } from './milkdrop-behaviors/gestural-presets';
import { createMilkdropPresetToyStarter } from './milkdrop-preset-toy';

export const start = createMilkdropPresetToyStarter({
  presetId: 'cosmic-particles',
  title: 'Cosmic Particles',
  description:
    'A cosmic preset with orbiting particle lines, nebula mesh motion, and big reactive depth.',
  createBehavior: createCosmicParticlesBehavior,
});
