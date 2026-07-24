export type WgslVectorWidth = 1 | 2 | 3 | 4;

export type WgslVectorCandidate = {
  target: string;
  expression: string;
};

const VECTOR_CONSTRUCTORS: Record<WgslVectorWidth, string> = {
  1: 'f32',
  2: 'vec2f',
  3: 'vec3f',
  4: 'vec4f',
};

export function getWgslVectorConstructor(width: WgslVectorWidth) {
  return VECTOR_CONSTRUCTORS[width];
}

export function emitWgslVectorAssignment({
  target,
  components,
}: {
  target: string;
  components: string[];
}) {
  const width = components.length as WgslVectorWidth;
  if (!VECTOR_CONSTRUCTORS[width]) {
    throw new Error(`Unsupported WGSL vector width: ${components.length}`);
  }

  if (width === 1) {
    return `${target} = ${components[0]};`;
  }

  return `${target} = ${VECTOR_CONSTRUCTORS[width]}(${components.join(', ')});`;
}

export function fuseAdjacentWgslScalars(
  candidates: WgslVectorCandidate[],
): WgslVectorCandidate[] {
  const fused: WgslVectorCandidate[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    const next = candidates[index + 1];
    if (next && current.target.endsWith('.x') && next.target.endsWith('.y')) {
      const targetBase = current.target.slice(0, -2);
      if (next.target.slice(0, -2) === targetBase) {
        fused.push({
          target: targetBase,
          expression: `vec2f(${current.expression}, ${next.expression})`,
        });
        index += 1;
        continue;
      }
    }
    fused.push(current);
  }
  return fused;
}
