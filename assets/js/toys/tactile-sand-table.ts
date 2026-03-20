import { createTactileSandTableBehavior } from './milkdrop-behaviors/tactile-sand-table';
import { createMilkdropPresetToyStarter } from './milkdrop-preset-toy';

export const start = createMilkdropPresetToyStarter({
  presetId: 'tactile-sand-table',
  title: 'Tactile Sand Table',
  description:
    'A sand-table preset with earthy ripples, tilt-steered gravity, and grounded reactive texture.',
  createBehavior: createTactileSandTableBehavior,
});
