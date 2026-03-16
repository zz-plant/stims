import { createStarFieldBehavior } from './milkdrop-behaviors/gestural-presets';
import { createMilkdropPresetToyStarter } from './milkdrop-preset-toy';

export const start = createMilkdropPresetToyStarter({
  presetId: 'star-field',
  title: 'Star Field',
  description:
    'A star field preset with drifting spark trails, dark nebula tones, and gentle beat shimmer.',
  createBehavior: createStarFieldBehavior,
});
