import {
  type FilterShaderPreset,
  generateSvgFilterDef,
} from '../ui/svg-filter-shaders.ts';
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
  const filterMarkup =
    filterPreset !== 'none'
      ? generateSvgFilterDef({ filterId, preset: filterPreset, audioPeak })
      : '';
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
        transition: 'transform var(--spring-enter), filter 0.3s ease',
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
        {filterMarkup ? (
          <defs
            /* biome-ignore lint/security/noDangerouslySetInnerHtml: static
               constants from svg-filter-shaders; only a numeric hash and
               numbers are interpolated, never user input */
            dangerouslySetInnerHTML={{ __html: filterMarkup }}
          />
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
