/**
 * The MilkDrop per-pixel warp sampling transform, as ordered algebra.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On WebGPU there is no CPU warp mesh: vm.ts hands the backend a procedural
 * mesh descriptor, buildMeshField returns zero points, and setWarpField only
 * exists on the WebGL manager. The per-fragment program inside
 * createFeedbackBlendOutputNode (feedback-manager-webgpu-tsl.ts) IS the entire
 * per-pixel warp path for that backend. Until now it consumed only five of the
 * ten per-pixel outputs -- warp, zoom, rot, dx, dy -- so a preset's writes to
 * cx, cy, sx, sy and zoomexp compiled and then evaporated.
 *
 * The TSL node graph cannot be unit tested without a GPU, so the same algebra
 * lives here twice: `computeWarpSampleUv` is the scalar reference (pure CPU,
 * covered by tests/unit/warp-sample-transform.test.ts) and the node builder is
 * a literal transcription of it. Change one, change the other.
 *
 * THE TRANSFORM
 * -------------
 * The oracle is butterchurn 2.6.7's `runPixelEquations` vertex loop
 * (node_modules/butterchurn/lib/butterchurn.js:2593-2660), the faithful
 * MilkDrop 2 port. Per vertex, with `x`/`y` the lattice NDC in [-1,1] (x
 * right, y up) and aspectx/aspecty <= 1 shrinking the minor axis:
 *
 *   rad   = sqrt(x^2*aspectx^2 + y^2*aspecty^2)          // fixed screen centre
 *   zoom2 = zoom ^ (zoomexp ^ (rad*2 - 1))
 *   u     =  x * 0.5 * aspectx / zoom2 + 0.5             // zoom about 0.5, NOT cx
 *   v     = -y * 0.5 * aspecty / zoom2 + 0.5
 *   u     = (u - cx) / sx + cx                           // anisotropic scale about cx/cy
 *   v     = (v - cy) / sy + cy
 *   u,v  += warp ripple                                  // 4-term warpf0..3
 *   u     = (u-cx)*cos(rot) - (v-cy)*sin(rot) + cx       // rotate about cx/cy
 *   v     = (u-cx)*sin(rot) + (v-cy)*cos(rot) + cy
 *   u    -= dx ;  v -= dy
 *   u     = (u - 0.5)/aspectx + 0.5                      // undo the aspect squeeze
 *   v     = (v - 0.5)/aspecty + 0.5
 *
 * The load-bearing structural facts, none of them obvious:
 *   - zoom is centred on the SCREEN centre; cx/cy are the centre for sx/sy and
 *     rot ONLY. With sx == sy == 1 and rot == 0, cx/cy cancel exactly and are
 *     mathematically inert. (projectM-upstream/300-beatdetect-bassmidtreb.milk
 *     is exactly that preset: `per_pixel_1=cx=x` on top of sx=sy=1, rot unset.
 *     Its cx write is dead in MilkDrop too, so making cx live must not move it.)
 *   - sx/sy divide. sx > 1 pushes the sampling coordinate outward, which pulls
 *     the image inward.
 *   - zoomexp only bites away from rad == 0.5, where zoomexp^(2r-1) == 1.
 *
 * WHERE THE REPO'S CPU MESH PATH DISAGREES (vm/geometry-builder.ts,
 * transformMeshPoint) -- butterchurn is picked every time, because it is the
 * MilkDrop 2 port and because the WebGPU fragment program's geometry seeding
 * (setPerPixelEnvGeometry) already follows it:
 *   1. rad. The CPU builds it from (x - cx, y - cy) in already-aspect-scaled
 *      [0,1] space and then multiplies by aspect AGAIN and by 2 -- aspect to
 *      the second power, re-centred on the preset's cx/cy. butterchurn uses
 *      the fixed screen centre and aspect to the first power. projectM 3.1.12
 *      agrees with butterchurn on the centre (rad binds read-only to origrad,
 *      a lattice built once from the screen centre).
 *   2. rad feedback. The CPU re-reads `local.rad` AFTER the per-pixel program
 *      runs, so a preset writing `rad` changes its own zoom exponent.
 *      butterchurn's `zoom2V` closes over the outer `rad` local, so writes to
 *      mdVSVertex.rad never reach the exponent. Taken: rad is an input.
 *   3. Ordering. The CPU rotates about cx/cy, THEN zooms about cx/cy, then
 *      ripples, then translates, then applies sx/sy about cx/cy last.
 *      butterchurn zooms about the screen centre first, then sx/sy, then
 *      ripple, then rotate, then translate. Taken: butterchurn's order.
 *   4. x/y feedback. The CPU maps the per-pixel program's possibly-rewritten
 *      `x`/`y` back to renderer space and transforms THAT. butterchurn keeps
 *      using the untouched lattice `x`/`y` and only feeds the rewritten values
 *      to nothing at all. Taken: butterchurn (writes to x/y are inert).
 *
 * DELIBERATELY NOT CHANGED HERE
 * -----------------------------
 * This function reproduces the WebGPU blend node's EXISTING handling of warp,
 * rot, dx and dy, which is not butterchurn's:
 *   - the ripple is the node graph's own applyFeedbackWarp, applied after the
 *     translate rather than between sx/sy and rot, and is therefore outside
 *     this function entirely;
 *   - dx/dy are ADDED in screen space, where butterchurn subtracts them in
 *     aspect space (so dx wants /aspectx and a sign flip). geometry-builder.ts
 *     carries a measured note that flipping the sign in isolation helps one
 *     preset and badly hurts another; that knot is not untied here;
 *   - the rotation runs in screen space, where butterchurn rotates in
 *     aspect-scaled space (an aspect shear apart at non-square aspect).
 * Fixing those is a separate, larger change with a much wider blast radius.
 */

/**
 * Per-pixel variables that, when written, mean the fragment program needs the
 * full transform rather than the legacy zoom/rot/dx/dy one. Lower-case.
 */
const WARP_TRANSFORM_TARGETS: ReadonlySet<string> = new Set([
  'cx',
  'cy',
  'sx',
  'sy',
  'zoomexp',
]);

/**
 * True when a compiled per-pixel program assigns to cx, cy, sx, sy or zoomexp.
 *
 * This is the blast-radius gate. A preset that does not write any of them gets
 * the byte-identical legacy node graph, so it cannot move by even one ULP --
 * which covers 8 of the 9 certified parity references, 100-square included.
 */
export function perPixelWritesWarpTransform(
  statements: ReadonlyArray<{ target: string }> | null | undefined,
): boolean {
  if (!statements) {
    return false;
  }
  return statements.some((statement) => {
    const target = statement.target.toLowerCase().split('.')[0] ?? '';
    return WARP_TRANSFORM_TARGETS.has(target);
  });
}

export type WarpSampleTransformInput = {
  /** Screen uv minus 0.5. x right, y UP (the node graph's `centeredUv`). */
  centeredX: number;
  centeredY: number;
  /** aspectX/aspectY, both <= 1, shrinking the minor axis. */
  aspectX: number;
  aspectY: number;
  /** Per-pixel outputs, already resolved for this fragment. */
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  zoom: number;
  zoomexp: number;
  rot: number;
  dx: number;
  dy: number;
  /** Geometric rad for this fragment; see computeWarpSampleRad. */
  rad: number;
};

/**
 * butterchurn's `rad`: fixed screen centre, aspect to the first power, no
 * doubling. Mirrors setPerPixelEnvGeometry in feedback-manager-webgpu-tsl.ts.
 */
export function computeWarpSampleRad(
  centeredX: number,
  centeredY: number,
  aspectX: number,
  aspectY: number,
): number {
  const ndcX = centeredX * 2 * aspectX;
  const ndcY = centeredY * 2 * aspectY;
  return Math.sqrt(ndcX * ndcX + ndcY * ndcY);
}

/** Divisor floor. Deliberately 0.0001, NOT 0.02: 100-square is zoom=0 and its
 * degenerate divide is load-bearing for a reference that already passes. */
const ZOOM_DIVISOR_FLOOR = 0.0001;
/** Keeps zoom^(zoomexp^(2r-1)) from overflowing f32 on presets that ship
 * extreme pairs. Only ever applied on the zoomexp != 1 branch, so it cannot
 * reach the 100-square path. */
const ZOOM_POW_CLAMP_MIN = 0.0001;
const ZOOM_POW_CLAMP_MAX = 10000;
/** zoomexp within this of 1 takes the exact `zoom` branch instead of pow(). A
 * GPU pow() is exp2(y*log2(x)), so pow(z, 1.0) is NOT z bit-for-bit; without
 * this every existing preset would shift by ~1e-7. */
const ZOOM_EXPONENT_IDENTITY_EPSILON = 1e-6;
/** sx/sy of exactly 0 would make the centre correction Inf-Inf -> NaN uv.
 * Mirrors transformMeshPoint's `scaleX || 1` guard. */
const SCALE_EPSILON = 1e-8;

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The zoom divisor: zoom ^ (zoomexp ^ (rad*2 - 1)), with the zoomexp == 1 fast
 * path returning `zoom` untouched so nothing shifts under a no-op exponent.
 */
export function computeWarpZoomDivisor(
  zoom: number,
  zoomexp: number,
  rad: number,
): number {
  if (Math.abs(zoomexp - 1) < ZOOM_EXPONENT_IDENTITY_EPSILON) {
    return zoom;
  }
  const exponent = clampNumber(
    clampNumber(zoomexp, ZOOM_POW_CLAMP_MIN, ZOOM_POW_CLAMP_MAX) **
      (rad * 2 - 1),
    ZOOM_POW_CLAMP_MIN,
    ZOOM_POW_CLAMP_MAX,
  );
  return clampNumber(
    clampNumber(zoom, ZOOM_POW_CLAMP_MIN, ZOOM_POW_CLAMP_MAX) ** exponent,
    ZOOM_POW_CLAMP_MIN,
    ZOOM_POW_CLAMP_MAX,
  );
}

/**
 * Scalar reference for the node graph's sampling coordinate, returned as
 * screen uv (0.5 already added back).
 *
 * Every correction term below is written so it evaluates to EXACTLY zero at
 * the identity values, which is what keeps presets that write only some of the
 * five variables from drifting:
 *   - `(u - c)/s + c` is emitted as `u/s + (c - c/s)`; at s == 1 the bracket
 *     is `c - c`, exactly 0, and `u/1` is exactly `u`.
 *   - `R(u - c) + c` is emitted as `R(u) + (c - R(c))`; at rot == 0 R is the
 *     numeric identity, so the bracket is `c - c`, exactly 0.
 * Writing them the obvious way instead costs ~1 ULP of the CENTRE per step,
 * which is ~6e-8 in uv -- small, but it would make a mathematically inert
 * `cx = x` (300-beatdetect) perturb a passing reference.
 */
export function computeWarpSampleUv(input: WarpSampleTransformInput): {
  x: number;
  y: number;
} {
  const {
    centeredX,
    centeredY,
    aspectX,
    aspectY,
    cx,
    cy,
    sx,
    sy,
    zoom,
    zoomexp,
    rot,
    dx,
    dy,
    rad,
  } = input;

  // cx/cy live in MilkDrop's aspect-squeezed [0,1] space with y measured
  // DOWNWARD; the node graph works in screen uv with y up. This is the same
  // mapping setPerPixelEnvGeometry uses to hand `x`/`y` to the program,
  // inverted.
  const centreX = (cx - 0.5) / aspectX;
  const centreY = -(cy - 0.5) / aspectY;

  const divisor = computeWarpZoomDivisor(zoom, zoomexp, rad);
  const zoomedX = centeredX / Math.max(divisor, ZOOM_DIVISOR_FLOOR);
  const zoomedY = centeredY / Math.max(divisor, ZOOM_DIVISOR_FLOOR);

  const safeSx = Math.abs(sx) < SCALE_EPSILON ? 1 : sx;
  const safeSy = Math.abs(sy) < SCALE_EPSILON ? 1 : sy;
  const scaledX = zoomedX / safeSx + (centreX - centreX / safeSx);
  const scaledY = zoomedY / safeSy + (centreY - centreY / safeSy);

  // Sampling coordinates invert the intended image transform, so the node
  // graph negates the sine; kept verbatim.
  const rotationSin = -Math.sin(rot);
  const rotationCos = Math.cos(rot);
  const rotatedScaledX = scaledX * rotationCos - scaledY * rotationSin;
  const rotatedScaledY = scaledX * rotationSin + scaledY * rotationCos;
  const rotatedCentreX = centreX * rotationCos - centreY * rotationSin;
  const rotatedCentreY = centreX * rotationSin + centreY * rotationCos;
  const rotatedX = rotatedScaledX + (centreX - rotatedCentreX);
  const rotatedY = rotatedScaledY + (centreY - rotatedCentreY);

  return {
    x: rotatedX + dx + 0.5,
    y: rotatedY + dy + 0.5,
  };
}

/**
 * The transform the node graph emitted before cx/cy/sx/sy/zoomexp existed:
 * rotate about the screen centre, divide by zoom, add dx/dy. Presets outside
 * the gate must keep matching this exactly.
 */
export function computeLegacyWarpSampleUv(
  input: Omit<
    WarpSampleTransformInput,
    'cx' | 'cy' | 'sx' | 'sy' | 'zoomexp' | 'rad' | 'aspectX' | 'aspectY'
  >,
): { x: number; y: number } {
  const { centeredX, centeredY, zoom, rot, dx, dy } = input;
  const rotationSin = -Math.sin(rot);
  const rotationCos = Math.cos(rot);
  const rotatedX = centeredX * rotationCos - centeredY * rotationSin;
  const rotatedY = centeredX * rotationSin + centeredY * rotationCos;
  const divisor = Math.max(zoom, ZOOM_DIVISOR_FLOOR);
  return {
    x: rotatedX / divisor + dx + 0.5,
    y: rotatedY / divisor + dy + 0.5,
  };
}
