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
    const c0 = candidates[index];
    const c1 = candidates[index + 1];
    const c2 = candidates[index + 2];
    const c3 = candidates[index + 3];

    // 4-component match (.x, .y, .z, .w) or (.r, .g, .b, .a)
    if (
      c0 &&
      c1 &&
      c2 &&
      c3 &&
      ((c0.target.endsWith('.x') &&
        c1.target.endsWith('.y') &&
        c2.target.endsWith('.z') &&
        c3.target.endsWith('.w') &&
        c1.target.slice(0, -2) === c0.target.slice(0, -2) &&
        c2.target.slice(0, -2) === c0.target.slice(0, -2) &&
        c3.target.slice(0, -2) === c0.target.slice(0, -2)) ||
        (c0.target.endsWith('.r') &&
          c1.target.endsWith('.g') &&
          c2.target.endsWith('.b') &&
          c3.target.endsWith('.a') &&
          c1.target.slice(0, -2) === c0.target.slice(0, -2) &&
          c2.target.slice(0, -2) === c0.target.slice(0, -2) &&
          c3.target.slice(0, -2) === c0.target.slice(0, -2)))
    ) {
      const targetBase = c0.target.slice(0, -2);
      fused.push({
        target: targetBase,
        expression: `vec4f(${c0.expression}, ${c1.expression}, ${c2.expression}, ${c3.expression})`,
      });
      index += 3;
      continue;
    }

    // 3-component match (.x, .y, .z) or (.r, .g, .b)
    if (
      c0 &&
      c1 &&
      c2 &&
      ((c0.target.endsWith('.x') &&
        c1.target.endsWith('.y') &&
        c2.target.endsWith('.z') &&
        c1.target.slice(0, -2) === c0.target.slice(0, -2) &&
        c2.target.slice(0, -2) === c0.target.slice(0, -2)) ||
        (c0.target.endsWith('.r') &&
          c1.target.endsWith('.g') &&
          c2.target.endsWith('.b') &&
          c1.target.slice(0, -2) === c0.target.slice(0, -2) &&
          c2.target.slice(0, -2) === c0.target.slice(0, -2)))
    ) {
      const targetBase = c0.target.slice(0, -2);
      fused.push({
        target: targetBase,
        expression: `vec3f(${c0.expression}, ${c1.expression}, ${c2.expression})`,
      });
      index += 2;
      continue;
    }

    // 2-component match (.x, .y) or (.r, .g)
    if (
      c0 &&
      c1 &&
      ((c0.target.endsWith('.x') &&
        c1.target.endsWith('.y') &&
        c1.target.slice(0, -2) === c0.target.slice(0, -2)) ||
        (c0.target.endsWith('.r') &&
          c1.target.endsWith('.g') &&
          c1.target.slice(0, -2) === c0.target.slice(0, -2)))
    ) {
      const targetBase = c0.target.slice(0, -2);
      fused.push({
        target: targetBase,
        expression: `vec2f(${c0.expression}, ${c1.expression})`,
      });
      index += 1;
      continue;
    }

    fused.push(c0);
  }
  return fused;
}
