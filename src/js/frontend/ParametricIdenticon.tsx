import type { FilterShaderPreset } from '../ui/svg-filter-shaders.ts';
import {
  generatePolygonPath,
  generateRoseCurvePath,
  generateTrochoidPath,
  pointsToSvgPathD,
  type SymmetryGroup,
} from '../ui/svg-geometry-engine.ts';

export interface ParametricIdenticonProps {
  seed: string;
  size?: number;
  symmetry?: SymmetryGroup;
  filterPreset?: FilterShaderPreset;
  audioPeak?: number;
  mood?: string;
  className?: string;
  ariaLabel?: string;
  interactive?: boolean;
}

export function ParametricIdenticon({
  seed,
  size = 40,
  symmetry = 'dihedral',
  filterPreset = 'none',
  audioPeak = 0,
  mood,
  className = '',
  ariaLabel,
  interactive = true,
}: ParametricIdenticonProps) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const uHash = Math.abs(hash);
  const hue = (uHash >> 3) % 360;

  const center = { x: size / 2, y: size / 2 };
  const radius = Math.max(4, size / 2 - 4 + audioPeak * 2);

  const filterId = `param-filter-${uHash}`;

  let pathD = '';
  if (symmetry === 'rose') {
    const k = 3 + (uHash % 5);
    pathD = pointsToSvgPathD(generateRoseCurvePath(center, radius, k));
  } else if (symmetry === 'trochoid') {
    pathD = pointsToSvgPathD(generateTrochoidPath(center, radius));
  } else {
    const sides = 3 + (uHash % 6);
    pathD = pointsToSvgPathD(generatePolygonPath(center, radius, sides));
  }

  const filterAttr = filterPreset !== 'none' ? `url(#${filterId})` : undefined;
  const label =
    ariaLabel ?? `Identicon badge for ${seed}${mood ? ` (${mood})` : ''}`;

  return (
    <span
      className={`stims-parametric-identicon ${
        interactive ? 'stims-parametric-identicon--interactive' : ''
      } ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition:
          'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease',
      }}
      aria-label={label}
      title={label}
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        {filterPreset !== 'none' ? (
          <defs>
            {filterPreset === 'glass-emboss' ? (
              <filter
                id={filterId}
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation="1.2"
                  result="blur"
                />
                <feSpecularLighting
                  in="blur"
                  surfaceScale={2.5}
                  specularConstant={1.3}
                  specularExponent={22}
                  lightingColor="#ffffff"
                  result="specular"
                >
                  <fePointLight x={-5000} y={-10000} z={15000} />
                </feSpecularLighting>
                <feComposite
                  in="specular"
                  in2="SourceGraphic"
                  operator="in"
                  result="specularOut"
                />
                <feBlend in="SourceGraphic" in2="specularOut" mode="screen" />
              </filter>
            ) : filterPreset === 'neon-aberration' ? (
              <filter
                id={filterId}
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feOffset
                  in="SourceGraphic"
                  dx="-1.5"
                  dy="0"
                  result="redShift"
                />
                <feOffset
                  in="SourceGraphic"
                  dx="1.5"
                  dy="0"
                  result="blueShift"
                />
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation={1.5 + audioPeak * 2}
                  result="glow"
                />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="redShift" />
                  <feMergeNode in="blueShift" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ) : filterPreset === 'liquid-warp' ? (
              <filter
                id={filterId}
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.035"
                  numOctaves={2}
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale={6 + audioPeak * 12}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="displaced"
                />
                <feGaussianBlur
                  in="displaced"
                  stdDeviation="0.8"
                  result="blurred"
                />
                <feMerge>
                  <feMergeNode in="blurred" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ) : null}
          </defs>
        ) : null}
        <path
          d={pathD}
          stroke={`hsl(${hue}, 85%, 65%)`}
          strokeWidth="1.8"
          strokeLinejoin="round"
          fill={`hsl(${hue}, 85%, 15%)`}
          fillOpacity={0.4}
          filter={filterAttr}
        />
      </svg>
    </span>
  );
}
