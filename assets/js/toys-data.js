export default [
  {
    slug: '3dtoy',
    title: '3D Toy',
    description: 'Dive into a twisting 3D tunnel that responds to sound.',
    module: 'assets/js/toys/three-d-toy.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'aurora-painter',
    title: 'Aurora Painter',
    description:
      'Paint flowing aurora ribbons that react to your microphone in layered waves.',
    module: 'assets/js/toys/aurora-painter.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'brand',
    title: 'Star Guitar Visualizer',
    description:
      'A visual journey inspired by an iconic music video, synced to your music.',
    module: 'assets/js/toys/brand.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'clay',
    title: 'Pottery Wheel Sculptor',
    description:
      'Spin and shape a 3D clay vessel with smoothing, carving, and pinching tools.',
    module: 'assets/js/toys/clay.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'defrag',
    title: 'Defrag Visualizer',
    description:
      'A nostalgic, sound-reactive visualizer evoking old defragmentation screens.',
    module: 'assets/js/toys/defrag.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'evol',
    title: 'Evolutionary Weirdcore',
    description:
      'Watch surreal landscapes evolve with fractals and glitches that react to music.',
    module: 'assets/js/toys/evol.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'geom',
    title: 'Microphone Geometry Visualizer',
    description:
      'Push shifting geometric forms directly from live mic input with responsive controls.',
    module: 'assets/js/toys/geom.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'holy',
    title: 'Ultimate Satisfying Visualizer',
    description:
      'Layered halos, particles, and morphing shapes that respond to your music.',
    module: 'assets/js/toys/holy.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'multi',
    title: 'Multi-Capability Visualizer',
    description: 'Shapes and lights move with both sound and device motion.',
    module: 'assets/js/toys/multi.ts',
    type: 'module',
    requiresWebGPU: true,
    allowWebGLFallback: true,
  },
  {
    slug: 'seary',
    title: 'Trippy Synesthetic Visualizer',
    description: 'Blend audio and visuals in a rich synesthetic experience.',
    module: 'assets/js/toys/seary.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'sgpat',
    title: 'Pattern Recognition Visualizer',
    description: 'See patterns form dynamically in response to sound.',
    module: 'assets/js/toys/sgpat.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'legible',
    title: 'Terminal Word Grid',
    description:
      'A retro green text grid that pulses to audio and surfaces fresh words as you play.',
    module: 'assets/js/toys/legible.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'svgtest',
    title: 'SVG + Three.js Visualizer',
    description:
      'A hybrid visualizer blending 2D and 3D elements, reacting in real time.',
    module: 'assets/js/toys/svgtest.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'symph',
    title: 'Dreamy Spectrograph',
    description: 'A relaxing spectrograph that moves gently with your audio.',
    module: 'assets/js/toys/symph.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'words',
    title: 'Interactive Word Cloud',
    description:
      'Speak and watch the word cloud react and shift with your voice.',
    module: 'assets/js/toys/words.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'cube-wave',
    title: 'Grid Visualizer',
    description:
      'Swap between cube waves and bouncing spheres without stopping the music.',
    module: 'assets/js/toys/cube-wave.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'bubble-harmonics',
    title: 'Bubble Harmonics',
    description:
      'Translucent, audio-inflated bubbles that split into harmonics on high frequencies.',
    module: 'assets/js/toys/bubble-harmonics.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'cosmic-particles',
    title: 'Cosmic Particles',
    description:
      'Jump between orbiting swirls and nebula fly-throughs with a single toggle.',
    module: 'assets/js/toys/cosmic-particles.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'lights',
    title: 'Audio Light Show',
    description:
      'Swap shader styles and color palettes while lights ripple with your microphone input.',
    module: 'assets/js/toys/lights.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'spiral-burst',
    title: 'Spiral Burst',
    description: 'Colorful spirals rotate and expand with every beat.',
    module: 'assets/js/toys/spiral-burst.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'rainbow-tunnel',
    title: 'Rainbow Tunnel',
    description: 'Fly through colorful rings that spin to your music.',
    module: 'assets/js/toys/rainbow-tunnel.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'star-field',
    title: 'Star Field',
    description: 'A field of shimmering stars reacts to the beat.',
    module: 'assets/js/toys/star-field.ts',
    type: 'module',
    requiresWebGPU: false,
  },
  {
    slug: 'fractal-kite-garden',
    title: 'Fractal Kite Garden',
    description:
      'Grow branching kite fractals that sway with mids and shimmer with crisp highs.',
    module: 'assets/js/toys/fractal-kite-garden.ts',
    type: 'module',
    requiresWebGPU: false,
    controls: ['Pattern density slider', 'Palette switches'],
  },
  {
    slug: 'tactile-sand-table',
    title: 'Tactile Sand Table',
    description:
      'Heightfield sand ripples that respond to bass, mids, and device tilt.',
    module: 'assets/js/toys/tactile-sand-table.ts',
    type: 'module',
    requiresWebGPU: false,
    controls: ['Grain size slider', 'Damping slider', 'Gravity lock toggle'],
  },
  {
    slug: 'bioluminescent-tidepools',
    title: 'Bioluminescent Tidepools',
    description:
      'Sketch glowing currents that bloom with high-frequency sparkle from your music.',
    module: 'assets/js/toys/bioluminescent-tidepools.ts',
    type: 'module',
    requiresWebGPU: false,
    controls: ['Trail length', 'Glow strength', 'Current speed'],
  },
  {
    slug: 'neon-wave',
    title: 'Neon Wave',
    description:
      'Premium retro-wave visualizer with bloom effects, custom shaders, and four stunning color themes.',
    module: 'assets/js/toys/neon-wave.ts',
    type: 'module',
    requiresWebGPU: false,
    capabilities: {
      microphone: true,
      demoAudio: true,
    },
    moods: ['energetic', 'immersive'],
    tags: ['synthwave', 'cyberpunk', 'retro', 'visualizer', 'bloom'],
    controls: ['Theme selector', 'Quality presets'],
  },
];
