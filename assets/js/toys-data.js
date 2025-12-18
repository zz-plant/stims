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
    module: './toy.html?toy=brand',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'clay',
    title: 'Pottery Wheel Sculptor',
    description:
      'Spin and shape a 3D clay vessel with smoothing, carving, and pinching tools.',
    module: './clay.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'defrag',
    title: 'Defrag Visualizer',
    description:
      'A nostalgic, sound-reactive visualizer evoking old defragmentation screens.',
    module: './toy.html?toy=defrag',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'evol',
    title: 'Evolutionary Weirdcore',
    description:
      'Watch surreal landscapes evolve with fractals and glitches that react to music.',
    module: './toy.html?toy=evol',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'geom',
    title: 'Microphone Geometry Visualizer',
    description:
      'Push shifting geometric forms directly from live mic input with responsive controls.',
    module: './geom.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'holy',
    title: 'Ultimate Satisfying Visualizer',
    description:
      'Layered halos, particles, and morphing shapes that respond to your music.',
    module: './holy.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'multi',
    title: 'Multi-Capability Visualizer',
    description: 'Shapes and lights move with both sound and device motion.',
    module: './toy.html?toy=multi',
    type: 'page',
    requiresWebGPU: true,
  },
  {
    slug: 'seary',
    title: 'Trippy Synesthetic Visualizer',
    description: 'Blend audio and visuals in a rich synesthetic experience.',
    module: './toy.html?toy=seary',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'sgpat',
    title: 'Pattern Recognition Visualizer',
    description: 'See patterns form dynamically in response to sound.',
    module: './sgpat.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'legible',
    title: 'Terminal Word Grid',
    description:
      'A retro green text grid that pulses to audio and surfaces fresh words as you play.',
    module: './legible.html',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'svgtest',
    title: 'SVG + Three.js Visualizer',
    description:
      'A hybrid visualizer blending 2D and 3D elements, reacting in real time.',
    module: './toy.html?toy=svgtest',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'symph',
    title: 'Dreamy Spectrograph',
    description: 'A relaxing spectrograph that moves gently with your audio.',
    module: './toy.html?toy=symph',
    type: 'page',
    requiresWebGPU: false,
  },
  {
    slug: 'words',
    title: 'Interactive Word Cloud',
    description:
      'Speak and watch the word cloud react and shift with your voice.',
    module: './toy.html?toy=words',
    type: 'page',
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
    module: './lights.html',
    type: 'page',
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
];
