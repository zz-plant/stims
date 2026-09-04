/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  options: {
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
        path: '^src/js/milkdrop/(?!(catalog-store-analysis|catalog-store|catalog-types|compiler-types|formatter|live-tile-pool|overlay/.*|preset-credit|preset-generator|preset-handles|preset-id-resolution|preset-lineage|preset-math-analyzer|preset-modulation|preset-mutations|preset-preview|reactivity-probe|runtime/first-run-preset|runtime/interaction-response|runtime/preset-preview-service|runtime-types|shader-execution-mode|types)\\.ts$)',
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
