import { createBioluminescentTidepoolsBehavior } from './milkdrop-behaviors/gestural-presets';
import { createMilkdropPresetToyStarter } from './milkdrop-preset-toy';

export const start = createMilkdropPresetToyStarter({
  presetId: 'bioluminescent-tidepools',
  title: 'Bioluminescent Tidepools',
  description:
    'A tidepool preset with caustic glow, flowing currents, and bright treble sparkle.',
  createBehavior: createBioluminescentTidepoolsBehavior,
});
