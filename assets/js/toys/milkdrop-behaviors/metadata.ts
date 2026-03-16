type ToyCapabilities = {
  microphone: boolean;
  demoAudio: boolean;
  motion: boolean;
};

type RecommendedCapability = 'microphone' | 'demoAudio' | 'motion';

type MilkdropBehaviorMetadata = {
  tags?: string[];
  controls?: string[];
  firstRunHint?: string;
  wowControl?: string;
  recommendedCapability?: RecommendedCapability;
  capabilities?: Partial<ToyCapabilities>;
};

type ToyMetadataLike = {
  slug: string;
  tags?: string[];
  controls?: string[];
  firstRunHint?: string;
  wowControl?: string;
  recommendedCapability?: RecommendedCapability;
  capabilities: ToyCapabilities;
};

export const milkdropBehaviorMetadataBySlug: Record<
  string,
  MilkdropBehaviorMetadata
> = {
  'aurora-painter': {
    tags: ['aurora', 'ribbons', 'gestural', 'touch'],
    controls: [
      'Drag drift + pinch bloom + rotate moods',
      'Quick preset + color mood buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Aurora Painter preset, drag to steer the ribbons, pinch to swell the glow, then rotate or use Color Mood buttons to switch palettes.',
    wowControl: 'Color mood buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'battle-fan': {
    tags: ['burst', 'patterns', 'touch', 'reactive'],
    controls: [
      'Touch drag fan steering',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Battle Fan preset, then drag to move the fan center and spike burst intensity with quick touch motion before adjusting Blend.',
    wowControl: 'Live source editor',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'bioluminescent-tidepools': {
    tags: ['ocean', 'bioluminescent', 'caustics', 'gestural'],
    controls: [
      'Drag currents + pinch lift + rotate moods',
      'Tidepool mood + current buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Bioluminescent Tidepools preset, drag to shape the currents, pinch to brighten the pool, then rotate or use Tidepool Mood buttons to shift the scene.',
    wowControl: 'Tidepool mood buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'cosmic-particles': {
    tags: ['particles', 'nebula', 'swirl', 'gestural'],
    controls: [
      'Drag drift + pinch depth + rotate modes',
      'Cosmic preset buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Cosmic Particles preset, drag to steer the orbit, pinch to deepen the pull, then rotate or use Cosmic Preset buttons to switch modes.',
    wowControl: 'Cosmic preset buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'cube-wave': {
    tags: ['grid', 'waves', 'mode-switch', 'gestural'],
    controls: [
      'Drag drift + pinch lift + rotate modes',
      'Grid mode buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Grid Visualizer preset, drag to steer the drift, pinch to lift the energy, then rotate or use Grid Mode buttons to switch feels.',
    wowControl: 'Grid mode buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'heel-toe-comets': {
    tags: ['particles', 'pulses', 'touch', 'reactive'],
    controls: [
      'Touch drag lane steering',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Heel-Toe Comets preset, then drag to angle the comet lanes and hold touch to increase rush depth before tweaking Blend.',
    wowControl: 'Live source editor',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'juke-grid': {
    tags: ['grid', 'glitch', 'touch', 'reactive'],
    controls: [
      'Touch drag lane steering',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Juke Grid preset, then drag across the screen to shove lane offsets and sharpen the chop energy before tuning Blend.',
    wowControl: 'Live source editor',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'mobile-ripples': {
    tags: ['mobile', 'ripples', 'touch'],
    controls: [
      'Touch drag steering',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Mobile Ripples preset, then drag to drift the ripple center and hold touch to widen the rings before adjusting Blend.',
    wowControl: 'Live source editor',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'pocket-pulse': {
    tags: ['mobile', 'pulses', 'touch'],
    controls: [
      'Touch drag steering + tap accents',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Pocket Pulse preset, then drag to steer the pulse center and tap to spike the glow before refining Blend or source fields.',
    wowControl: 'Live source editor',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'rainbow-tunnel': {
    tags: ['tunnel', 'rainbow', 'immersive', 'gestural'],
    controls: [
      'Drag drift + pinch speed + rotate palettes',
      'Motion mode + color drift buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Rainbow Tunnel preset, drag to steer the tunnel, pinch to increase speed, then rotate or use Color Drift buttons to cycle the palette.',
    wowControl: 'Color drift buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'spiral-burst': {
    tags: ['spirals', 'burst', 'gestural'],
    controls: [
      'Drag spin + pinch burst + rotate palettes',
      'Spiral mode + palette buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Spiral Burst preset, drag to torque the spin, pinch to intensify the burst, then rotate or use Spiral controls to change the feel.',
    wowControl: 'Spiral mode buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'star-field': {
    tags: ['stars', 'nebula', 'gestural'],
    controls: [
      'Drag drift + pinch sparkle + rotate palettes',
      'Sky intensity + palette buttons',
      'Pulse meter',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    firstRunHint:
      'Start with the Star Field preset, drag to steer drift, pinch to lift sparkle, then rotate or use Sky Palette buttons while watching the pulse meter.',
    wowControl: 'Sky palette buttons',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'tactile-sand-table': {
    tags: ['sand', 'tilt', 'haptics', 'motion'],
    controls: [
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
      'Motion controls (enable tilt, lock gravity, re-center)',
    ],
    firstRunHint:
      'Start with the Tactile Sand Table preset, enable tilt control in Gravity settings, then lock or re-center gravity as needed.',
    wowControl: 'Tilt gravity controls',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: true },
  },
};

export function applyMilkdropBehaviorMetadata<T extends ToyMetadataLike>(
  entries: T[],
) {
  return entries.map((entry) => {
    const metadata = milkdropBehaviorMetadataBySlug[entry.slug];
    if (!metadata) {
      return entry;
    }

    return {
      ...entry,
      tags: metadata.tags ? [...metadata.tags] : entry.tags,
      controls: metadata.controls ? [...metadata.controls] : entry.controls,
      firstRunHint: metadata.firstRunHint ?? entry.firstRunHint,
      wowControl: metadata.wowControl ?? entry.wowControl,
      recommendedCapability:
        metadata.recommendedCapability ?? entry.recommendedCapability,
      capabilities: metadata.capabilities
        ? {
            ...entry.capabilities,
            ...metadata.capabilities,
          }
        : entry.capabilities,
    };
  });
}
