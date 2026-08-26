/**
 * Shared typing for three.js TSL node graphs.
 *
 * These materials used to carry a hand-rolled `TslNode` structural type,
 * declared independently in two files with a `[key: string]: unknown` escape
 * hatch. It existed for a reason that has since disappeared: under the
 * repo's old `moduleResolution: node10`, `three/webgpu` did not resolve to
 * any types at all — the imports carried `@ts-expect-error` saying exactly
 * that — so the entire native-WebGPU layer typechecked as `any` and a
 * stand-in was the only way to get member access to compile.
 *
 * `moduleResolution: bundler` reaches @types/three's real node typings, so
 * the stand-in is obsolete. This module exists so the replacement is named
 * once rather than three times.
 */

import type { Color } from 'three';
import type ThreeNode from 'three/src/nodes/core/Node.js';
import { TSL } from 'three/webgpu';

/**
 * A TSL node carrying its value type, e.g. `TslNode<'vec4'>`.
 *
 * Imported through three's `./src/*` export rather than `three/webgpu`
 * because the generic `Node` alias is not re-exported from the bundle entry
 * point — only the concrete node classes are.
 *
 * The default is `'float'`, not `unknown`: `Node<unknown>` carries no
 * swizzles and no arithmetic, so a bare `TslNode` would be useless, and
 * scalars are what the bare form is used for throughout these materials. A
 * vector position must say so — `TslNode<'vec4'>` — which is the point.
 */
export type TslNode<T = 'float'> = ThreeNode<T>;

/** Value types an instanced attribute can carry in these materials. */
export type TslAttributeType = 'float' | 'vec2' | 'vec3' | 'vec4';

/**
 * `attribute()` typed by the value it actually holds.
 *
 * three types the return as `AttributeNode<Name>` — the generic carries the
 * attribute NAME, not its value type — so `.x`, `.w`, `.mul()` and friends
 * are invisible on it. The value type is always known at the call site (it
 * is the second argument), so this states the correspondence once instead of
 * casting at every use.
 */
export function typedAttribute<T extends TslAttributeType>(
  name: string,
  nodeType: T,
): TslNode<T> {
  return TSL.attribute(name, nodeType) as unknown as TslNode<T>;
}

/**
 * A uniform node: a TSL node whose `value` the host writes each frame.
 *
 * The previous stand-in declared this as `value: number & Color`, an
 * intersection nothing can satisfy — it compiled only because the whole
 * module was untyped. Materials here write both numbers and Colors through
 * the same handles, so the value is genuinely heterogeneous and is typed as
 * such rather than as a fiction.
 *
 * The node half is `'float'`, which is what all but a handful of these
 * uniforms are used as. Deriving it from the value type instead (vec3 for
 * `Color`) is more faithful and was tried: it makes every uniform bank
 * heterogeneous, so the `Record<string, …>` parameters that take a whole
 * bank stop matching, and the error count went up rather than down. The few
 * colour uniforms that need their vec3-ness say so at the point of use via
 * `asColorNode`, which keeps the exception where it is legible.
 */
/** What these materials actually push through a uniform each frame. */
export type TslUniformValue = number | Color;

export type TslUniformNode<V = TslUniformValue> = TslNode<'float'> & {
  value: V;
};

/**
 * Map of uniform handles, keyed like the state object they mirror.
 *
 * Uniform banks are passed around whole, so every entry carries the same
 * node type; see `asColorNode` for the colour exception.
 */
export type TslUniformNodes<T> = { [K in keyof T]: TslUniformNode };

/**
 * `uniform()` for a value whose type is only known as a union.
 *
 * three overloads `uniform()` per value type, and TypeScript cannot pick an
 * overload for a union argument — `uniform(number | Color)` resolves to
 * nothing. These materials build uniform banks by mapping over a state
 * object whose entries are exactly that union, so the narrowing happens once
 * here. It is a real branch, not a cast: each call reaches the overload that
 * actually matches the value being passed.
 */
export function typedUniform(
  value: number | Color,
): TslUniformNode<number | Color> {
  const node =
    typeof value === 'number' ? TSL.uniform(value) : TSL.uniform(value);
  return node as unknown as TslUniformNode<number | Color>;
}

/**
 * A colour uniform seen as the vec3 node it actually is.
 *
 * Uniform banks are typed uniformly as float nodes so they can be passed
 * around as a whole (see `TslUniformNode`). A handful of entries hold a
 * `Color` and get spread into a `vec4(tint, alpha)`, which needs three
 * components. This is the single place that exception is stated, rather than
 * making every bank heterogeneous to serve three call sites.
 */
export function asColorNode(node: TslUniformNode): TslNode<'vec3'> {
  return node as unknown as TslNode<'vec3'>;
}

/**
 * A sampled texel seen as the vec4 it is.
 *
 * The aux-texture samplers are a single `select()` chain over ~15 branches,
 * every one of which constructs a vec4. three infers the chain's type as
 * `Node<'float' | 'vec4'>` — an artifact of widening across that many
 * operands, not a branch that genuinely yields a scalar — and `.rgb` is
 * unavailable on the union. Checked against the source before narrowing:
 * there is no float-returning path.
 */
export function asVec4Node(node: TslNode<'float' | 'vec4'>): TslNode<'vec4'> {
  return node as unknown as TslNode<'vec4'>;
}
