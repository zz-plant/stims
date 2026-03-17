type ToyCapabilities = {
  microphone: boolean;
  demoAudio: boolean;
  motion: boolean;
};

type RecommendedCapability = 'microphone' | 'demoAudio' | 'motion';

type MilkdropBehaviorMetadata = {
  tags?: string[];
  controls?: string[];
  desktopHints?: string[];
  touchHints?: string[];
  firstRunHint?: string;
  wowControl?: string;
  recommendedCapability?: RecommendedCapability;
  capabilities?: Partial<ToyCapabilities>;
};

type ToyMetadataLike = {
  slug: string;
  tags?: string[];
  controls?: string[];
  desktopHints?: string[];
  touchHints?: string[];
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
      'Move/drag ribbons + scroll bloom + Q/E moods',
      'Quick preset + color mood buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to steer the ribbons.',
      'Drag to push the drift.',
      'Scroll or trackpad pinch to swell the glow.',
      'Press Space for an accent burst.',
      'Press 1/2/3 for quick preset changes.',
      'Press Q/E to cycle color moods.',
    ],
    touchHints: [
      'Drag to steer the ribbons.',
      'Pinch to swell the glow, then rotate to cycle moods.',
    ],
    firstRunHint:
      'Start with the Aurora Painter preset, move or drag to steer the ribbons, scroll to swell the glow, then press Q/E or use Color Mood buttons to switch palettes.',
    wowControl: 'Q/E mood cycling',
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
      'Move/drag currents + scroll lift + Q/E moods',
      'Tidepool mood + current buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to shape the currents.',
      'Drag to shove the pool harder.',
      'Scroll or trackpad pinch to brighten the lift.',
      'Press Space for a bloom accent.',
      'Press 1/2/3 for current profiles.',
      'Press Q/E to cycle tidepool moods.',
    ],
    touchHints: [
      'Drag to shape the currents.',
      'Pinch to brighten the pool, then rotate to shift moods.',
    ],
    firstRunHint:
      'Start with the Bioluminescent Tidepools preset, move or drag to shape the currents, scroll to brighten the pool, then press Q/E or use Tidepool Mood buttons to shift the scene.',
    wowControl: 'Q/E tidepool moods',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'cosmic-particles': {
    tags: ['particles', 'nebula', 'swirl', 'gestural'],
    controls: [
      'Move/drag orbit + scroll depth + Q/E modes',
      'Cosmic preset buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to steer the orbit.',
      'Drag to shove the field.',
      'Scroll or trackpad pinch to deepen the pull.',
      'Press Space for an accent burst.',
      'Press 1/2 for quick cosmic looks.',
      'Press Q/E to swap presets.',
    ],
    touchHints: [
      'Drag to steer the orbit.',
      'Pinch to deepen the pull, then rotate to switch modes.',
    ],
    firstRunHint:
      'Start with the Cosmic Particles preset, move or drag to steer the orbit, scroll to deepen the pull, then press Q/E or use Cosmic Preset buttons to switch modes.',
    wowControl: 'Q/E cosmic switching',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'cube-wave': {
    tags: ['grid', 'waves', 'mode-switch', 'gestural'],
    controls: [
      'Move/drag drift + scroll lift + Q/E modes',
      'Grid mode buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to steer the grid.',
      'Drag to shove the chop energy.',
      'Scroll or trackpad pinch to lift the energy.',
      'Press Space for a pulse accent.',
      'Press 1/2/3 for quick grid modes.',
      'Press Q/E to cycle modes.',
    ],
    touchHints: [
      'Drag to steer the drift.',
      'Pinch to lift the energy, then rotate to switch modes.',
    ],
    firstRunHint:
      'Start with the Grid Visualizer preset, move or drag to steer the drift, scroll to lift the energy, then press Q/E or use Grid Mode buttons to switch feels.',
    wowControl: 'Q/E grid mode swaps',
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
      'Move/drag tunnel + scroll speed + Q/E palettes',
      'Motion mode + color drift buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to steer the tunnel.',
      'Drag to torque the tunnel walls.',
      'Scroll or trackpad pinch to increase speed.',
      'Press Space for a burst hit.',
      'Press 1/2/3 for motion modes.',
      'Press Q/E to cycle color drift.',
    ],
    touchHints: [
      'Drag to steer the tunnel.',
      'Pinch to increase speed, then rotate to cycle palettes.',
    ],
    firstRunHint:
      'Start with the Rainbow Tunnel preset, move or drag to steer the tunnel, scroll to increase speed, then press Q/E or use Color Drift buttons to cycle the palette.',
    wowControl: 'Q/E color drift',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'spiral-burst': {
    tags: ['spirals', 'burst', 'gestural'],
    controls: [
      'Move/drag spin + scroll burst + Q/E palettes',
      'Spiral mode + palette buttons',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to torque the spiral.',
      'Drag to slam the burst harder.',
      'Scroll or trackpad pinch to intensify the burst.',
      'Press Space for a hit accent.',
      'Press 1/2/3 for quick spiral modes.',
      'Press Q/E to cycle palettes.',
    ],
    touchHints: [
      'Drag to torque the spin.',
      'Pinch to intensify the burst, then rotate to cycle palettes.',
    ],
    firstRunHint:
      'Start with the Spiral Burst preset, move or drag to torque the spin, scroll to intensify the burst, then press Q/E or use Spiral controls to change the feel.',
    wowControl: 'Q/E spiral palette cycling',
    recommendedCapability: 'demoAudio',
    capabilities: { motion: false },
  },
  'star-field': {
    tags: ['stars', 'nebula', 'gestural'],
    controls: [
      'Move/drag drift + scroll sparkle + Q/E palettes',
      'Sky intensity + palette buttons',
      'Pulse meter',
      'Preset browser + favorites',
      'Blend duration + autoplay/random',
      'Live source editor + import/export',
    ],
    desktopHints: [
      'Move to steer the drift.',
      'Drag to shove the star field.',
      'Scroll or trackpad pinch to lift sparkle.',
      'Press Space for a pulse hit.',
      'Press 1/2/3 for sky intensity.',
      'Press Q/E to cycle palettes.',
    ],
    touchHints: [
      'Drag to steer drift.',
      'Pinch to lift sparkle, then rotate to cycle palettes.',
    ],
    firstRunHint:
      'Start with the Star Field preset, move or drag to steer drift, scroll to lift sparkle, then press Q/E or use Sky Palette buttons while watching the pulse meter.',
    wowControl: 'Q/E sky palettes',
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
      desktopHints: metadata.desktopHints
        ? [...metadata.desktopHints]
        : entry.desktopHints,
      touchHints: metadata.touchHints
        ? [...metadata.touchHints]
        : entry.touchHints,
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
