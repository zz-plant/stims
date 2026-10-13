/** @type {import('dependency-cruiser').IConfiguration} */

/**
 * The milkdrop modules the frontend shell may import directly. Everything
 * else under src/js/milkdrop/ is engine internals: only frontend/engine/ (the
 * adapter layer) may import those.
 *
 * Entries are path fragments relative to src/js/milkdrop/, matched up to a
 * `.ts` extension boundary — `overlay/.*` admits the whole overlay subtree.
 *
 * This list *is* the public surface, so each addition is a design decision
 * made in review, not a convenience. When it grows, ask first whether the
 * shell should instead receive the capability through frontend/engine/.
 */
const MILKDROP_SHELL_SURFACE = [
  'catalog-store',
  'catalog-store-analysis',
  'catalog-types',
  'compiler-types',
  'formatter',
  'live-tile-pool',
  'overlay/.*',
  'preset-credit',
  'preset-generator',
  'preset-handles',
  'preset-id-resolution',
  'preset-lineage',
  'preset-math-analyzer',
  'preset-modulation',
  'preset-mutations',
  'preset-preview',
  'reactivity-probe',
  'runtime-types',
  'runtime/first-run-preset',
  'runtime/interaction-response',
  'runtime/preset-preview-service',
  'shader-execution-mode',
  'types',
  'variable-probe',
];

/** Negative-lookahead pattern admitting exactly the shell surface modules. */
function milkdropShellSurfacePattern() {
  const alternatives = MILKDROP_SHELL_SURFACE.join('|');
  return `^src/js/milkdrop/(?!(${alternatives})\\.ts$)`;
}

const config = {
  options: {
    parser: 'swc',
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    exclude: {
      path: ['\\.milk$'],
    },
    doNotFollow: {
      path: ['^three/examples/'],
    },
  },
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {
        path: '^(src|scripts|tests)/',
      },
      to: {
        circular: true,
        path: '^(src|scripts|tests)/',
        // A cycle through an `import type` edge is erased at compile time.
        // The tsc parser dropped those edges; swc keeps them, tagged.
        viaOnly: { dependencyTypesNot: ['type-only'] },
      },
    },
    {
      name: 'no-prod-to-tests',
      severity: 'error',
      comment: 'Production code should not depend on test-only helpers.',
      from: {
        path: '^(src|scripts)/',
      },
      to: {
        path: '^tests/',
      },
    },
    {
      name: 'frontend-engine-seam',
      severity: 'error',
      comment:
        'Frontend shell code outside frontend/engine/ must only import the declared public surface of milkdrop.',
      from: {
        path: '^src/js/frontend/(?!engine/)',
      },
      to: {
        path: milkdropShellSurfacePattern(),
      },
    },
    {
      name: 'engine-runtime-only-via-adapter',
      severity: 'error',
      comment:
        'Only frontend/engine/ may import runtime core, renderers, feedback managers, VM, or compiler entry points.',
      from: {
        path: '^src/js/frontend/(?!engine/)',
      },
      to: {
        path: '^src/js/milkdrop/(runtime\\.ts|renderer-|feedback-|vm|compiler\\.ts)',
      },
    },
  ],
};

export default config;
