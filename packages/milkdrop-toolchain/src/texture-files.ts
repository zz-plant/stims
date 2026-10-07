// Bundled texture files referenced by MilkDrop shader samplers and the
// WebGPU/WebGL feedback managers. Pure data, no three.js imports: the compiler
// resolves sampler names against these tables on every preset compile, so
// importing them must not drag the renderer bundles (three/webgpu) into the
// compiler chunk.
export const MILKDROP_TEXTURE_FILES = {
  noise: 'seamless_perlin_noise.png',
  perlin: 'seamless_perlin_noise.png',
  simplex: 'simplex_noise_3d.png',
  voronoi: 'voronoi_cellular.png',
  aura: 'colorful_aura_gradient.png',
  caustics: 'water_caustics.png',
  pattern: 'circuit_board_pattern.png',
  fractal: 'crystal_fractal.png',
} as const;

// Canonical sampler names that exist only for custom-sampler aliasing (no
// real MilkDrop built-in warp/overlay texture slot, unlike the names in
// MILKDROP_TEXTURE_FILES above). Kept separate so they don't force the
// legacy warp/overlay texture-selector plumbing (AUX_TEXTURE_SPECS et al.,
// exhaustively keyed off MILKDROP_TEXTURE_FILES) to grow a slot it has no
// real numeric ID for.
export const CUSTOM_TEXTURE_FILES = {
  glyph: 'glyph_matrix_tile.png',
  organic: 'organic_mottle.png',
} as const;
