/**
 * Type barrel for the toolchain.
 *
 * In Stims this file also re-exports the catalog, renderer and runtime type
 * modules; those depend on three.js and the engine services, so the package
 * carries only the compiler-facing types plus the few definitions the copied
 * modules need (see `runtime-signals.ts`).
 */
export * from './common-types.ts';
export * from './compiler-types.ts';
export * from './runtime-signals.ts';
