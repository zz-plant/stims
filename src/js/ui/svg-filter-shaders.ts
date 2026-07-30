/**
 * Inline SVG Filter Shaders
 * Resolution-independent GPU vector filter definitions.
 */

export type FilterShaderPreset =
  | 'none'
  | 'glass-emboss'
  | 'neon-aberration'
  | 'liquid-warp';

export interface SvgFilterOptions {
  filterId: string;
  preset: FilterShaderPreset;
  audioPeak?: number;
}

/**
 * Returns XML filter markup for specified inline SVG filter shader presets.
 */
export function generateSvgFilterDef({
  filterId,
  preset,
  audioPeak = 0,
}: SvgFilterOptions): string {
  if (preset === 'none') {
    return '';
  }

  const warpScale = (6 + audioPeak * 12).toFixed(1);

  switch (preset) {
    case 'glass-emboss':
      return `
        <filter id="${filterId}" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
          <feSpecularLighting in="blur" surfaceScale="2.5" specularConstant="1.3" specularExponent="22" lighting-color="#ffffff" result="specular">
            <fePointLight x="-5000" y="-10000" z="15000" />
          </feSpecularLighting>
          <feComposite in="specular" in2="SourceGraphic" operator="in" result="specularOut" />
          <feBlend in="SourceGraphic" in2="specularOut" mode="screen" />
        </filter>
      `;

    case 'neon-aberration':
      return `
        <filter id="${filterId}" x="-30%" y="-30%" width="160%" height="160%">
          <feOffset in="SourceGraphic" dx="-1.5" dy="0" result="redShift" />
          <feOffset in="SourceGraphic" dx="1.5" dy="0" result="blueShift" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="${(1.5 + audioPeak * 2).toFixed(1)}" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="redShift" />
            <feMergeNode in="blueShift" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      `;

    case 'liquid-warp':
      return `
        <filter id="${filterId}" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="${warpScale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="0.8" result="blurred" />
          <feMerge>
            <feMergeNode in="blurred" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      `;

    default:
      return '';
  }
}
