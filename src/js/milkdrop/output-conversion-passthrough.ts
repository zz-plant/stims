/**
 * Renders a MilkDrop frame to the canvas with the renderer's output tone
 * mapping and color-space encode suspended.
 *
 * MilkDrop's picture is already display-referred: every colour a preset names
 * (ib_r, wave colours, comp shader output) is the literal 8-bit value the
 * reference renderer puts on screen. The WebGL path gets that for free — it
 * paints through raw ShaderMaterials, which skip both the tone-mapping and
 * `colorspace_fragment` chunks. three's WebGPU renderer instead applies the
 * renderer-level tone mapping and output encode as a post pass on every
 * canvas-target render, regardless of material flags, so the same frame comes
 * out ACES-tone-mapped and re-encoded. Wrapping the canvas render in this
 * helper is what keeps the two backends showing the same picture.
 */

import { resolveLinearOutputColorSpace } from '../core/wide-gamut.ts';

export type OutputConversionRenderer = {
  toneMapping?: number;
  outputColorSpace?: string;
};

const NO_TONE_MAPPING = 0;

/**
 * Runs `render` with the renderer's output conversions suspended, restoring
 * both settings afterwards even if the render throws.
 */
export function renderWithoutOutputConversion<T>(
  renderer: OutputConversionRenderer | null | undefined,
  render: () => T,
): T {
  if (!renderer) {
    return render();
  }

  const savedToneMapping = renderer.toneMapping ?? NO_TONE_MAPPING;
  const toneMappingSuspended = savedToneMapping !== NO_TONE_MAPPING;
  if (toneMappingSuspended) {
    renderer.toneMapping = NO_TONE_MAPPING;
  }

  // The linear counterpart of whatever gamut is configured: pinning this to
  // linear-sRGB unconditionally would quietly undo wide-gamut output, since
  // this suspension is exactly where the present pass's encode is chosen.
  const linearOutputColorSpace = resolveLinearOutputColorSpace();
  const savedOutputColorSpace = renderer.outputColorSpace;
  const colorSpaceSuspended =
    savedOutputColorSpace !== undefined &&
    savedOutputColorSpace !== linearOutputColorSpace;
  if (colorSpaceSuspended) {
    renderer.outputColorSpace = linearOutputColorSpace;
  }

  try {
    return render();
  } finally {
    if (toneMappingSuspended) {
      renderer.toneMapping = savedToneMapping;
    }
    if (colorSpaceSuspended) {
      renderer.outputColorSpace = savedOutputColorSpace;
    }
  }
}
