/**
 * Words someone might type into Browse to find a preset by what it looks like.
 *
 * `term` is what lands in a catalog entry's `searchTerms`; `query` is the
 * phrase actually embedded, worded as a description of a frame because the
 * model matches descriptions better than bare nouns. Each term is scored
 * against every preview, and only presets where it stands out are tagged
 * (see scripts/build-visual-embeddings.ts), so a term that fits nothing
 * tags nothing rather than tagging at random.
 *
 * Figurative terms ("eye", "face", "heart") were tried and dropped: on
 * abstract frames their best matches were blank white previews.
 */
export const VISUAL_TERMS: ReadonlyArray<{ term: string; query: string }> = [
  // Structures
  { term: 'tunnel', query: 'a tunnel receding into the center of the frame' },
  { term: 'vortex', query: 'a swirling vortex spinning around the center' },
  { term: 'spiral', query: 'a spiral pattern' },
  { term: 'kaleidoscope', query: 'a symmetric kaleidoscope pattern' },
  { term: 'mandala', query: 'a circular mandala with radial symmetry' },
  { term: 'rings', query: 'concentric rings' },
  { term: 'starburst', query: 'rays bursting outward from the center' },
  { term: 'grid', query: 'a grid of lines or tiles' },
  { term: 'checkerboard', query: 'a checkerboard pattern' },
  { term: 'stripes', query: 'bold parallel stripes' },
  { term: 'waves', query: 'rolling waves of color' },
  { term: 'ripples', query: 'ripples spreading across a surface' },
  { term: 'lattice', query: 'an interlocking lattice or web' },
  { term: 'cube', query: 'a 3D cube' },
  { term: 'sphere', query: 'a glowing sphere or orb' },
  { term: 'crystal', query: 'faceted crystals and shards' },
  { term: 'fractal', query: 'a self-similar fractal' },
  { term: 'branches', query: 'branching lines like a tree or veins' },
  { term: 'tentacles', query: 'long curling tentacles' },
  { term: 'cells', query: 'organic cells or a cellular texture' },
  { term: 'bubbles', query: 'floating bubbles' },
  { term: 'flower', query: 'a flower with petals' },
  { term: 'feathers', query: 'soft feathers or fur' },
  { term: 'butterfly', query: 'a butterfly with symmetric wings' },
  // Natural phenomena
  { term: 'fire', query: 'flames and fire' },
  { term: 'smoke', query: 'drifting smoke' },
  { term: 'clouds', query: 'clouds' },
  { term: 'water', query: 'water or a liquid surface' },
  { term: 'ocean', query: 'an underwater ocean scene' },
  { term: 'ink', query: 'ink diffusing in water' },
  { term: 'lightning', query: 'lightning bolts' },
  { term: 'plasma', query: 'a glowing plasma field' },
  { term: 'aurora', query: 'aurora borealis light curtains' },
  { term: 'galaxy', query: 'a spiral galaxy' },
  { term: 'nebula', query: 'a colorful nebula in space' },
  { term: 'starfield', query: 'a field of stars in black space' },
  { term: 'sun', query: 'a bright sun' },
  { term: 'planet', query: 'a planet in space' },
  { term: 'marble', query: 'swirled marble texture' },
  { term: 'oil', query: 'an oil slick with iridescent swirls' },
  // Marks and traces
  { term: 'particles', query: 'many small glowing particles' },
  { term: 'sparkles', query: 'glittering sparkles' },
  { term: 'dots', query: 'a pattern of dots' },
  { term: 'lines', query: 'thin glowing lines on a dark background' },
  { term: 'ribbons', query: 'flowing ribbons of light' },
  { term: 'threads', query: 'tangled threads or strings' },
  { term: 'oscilloscope', query: 'an oscilloscope waveform trace' },
  { term: 'laser', query: 'laser beams' },
  { term: 'scanlines', query: 'horizontal scan lines like an old screen' },
  { term: 'glitch', query: 'digital glitch artifacts' },
  { term: 'static', query: 'television static noise' },
  { term: 'blur', query: 'a soft blurry wash of color' },
  // Color and light
  { term: 'rainbow', query: 'a full rainbow of colors' },
  { term: 'neon', query: 'neon glow on black' },
  { term: 'pastel', query: 'soft pastel colors' },
  { term: 'black and white', query: 'a black and white image with no color' },
  { term: 'dark', query: 'a mostly dark frame with faint light' },
  { term: 'bright', query: 'a very bright frame' },
  { term: 'gold', query: 'gold and amber tones' },
  { term: 'purple', query: 'purple and violet tones' },
  { term: 'pink', query: 'pink and magenta tones' },
  { term: 'red', query: 'deep red tones' },
  { term: 'green', query: 'green tones' },
  { term: 'blue', query: 'blue tones' },
  { term: 'cyan', query: 'cyan and teal tones' },
  { term: 'orange', query: 'orange tones' },
  // Feel
  { term: 'psychedelic', query: 'a psychedelic trippy image' },
  { term: 'minimal', query: 'a minimal sparse image with lots of empty space' },
  { term: 'symmetric', query: 'a perfectly mirror-symmetric image' },
  { term: 'chaotic', query: 'a chaotic busy noisy image' },
  { term: 'organic', query: 'organic biological forms' },
  { term: 'geometric', query: 'clean geometric shapes' },
  { term: 'painterly', query: 'a painterly image like brush strokes' },
  { term: 'retro', query: 'a retro 1990s computer graphics look' },
];
