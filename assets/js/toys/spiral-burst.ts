import { createSpiralBurstBehavior } from './milkdrop-behaviors/gestural-presets';
import { createMilkdropPresetToyStarter } from './milkdrop-preset-toy';

export const start = createMilkdropPresetToyStarter({
  presetId: 'spiral-burst',
  title: 'Spiral Burst',
  description:
    'A spiral preset with blooming coils, central bursts, and emphatic beat pulses.',
  createBehavior: createSpiralBurstBehavior,
});
